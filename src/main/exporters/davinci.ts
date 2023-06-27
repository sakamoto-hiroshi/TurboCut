import ffmpeg, { FfprobeData } from 'fluent-ffmpeg';
import { Clip, VideoInfo } from 'shared/types';
import { js2xml, ElementCompact } from 'xml-js';
import { dialog } from 'electron';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// Convert the timecode of the video to seconds.
function framesToTimecode(frames: number, frameRate: number): string {
  // Rounding the frame rate to the nearest integer is necessary to avoid floating point errors
  const fps = Math.round(frameRate);
  // Calculate the number of hours, minutes, seconds, and frames
  const hours = Math.floor(frames / (3600 * fps));
  const minutes = Math.floor((frames % (3600 * fps)) / (60 * fps));
  const seconds = Math.floor(((frames % (3600 * fps)) % (60 * fps)) / fps);
  const frs = Math.floor(((frames % (3600 * fps)) % (60 * fps)) % fps);

  // Format the timecode string as HH:MM:SS:FF (hours, minutes, seconds, frames)
  // This is necessary to ensure that the timecode is parsed correctly by DaVinci Resolve.
  const timecode = `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frs
    .toString()
    .padStart(2, '0')}`;

  return timecode;
}

function framesToSeconds(frames: number, frameRate: number): number {
  // Rounding the frame rate to the nearest integer is necessary to avoid floating point errors
  return Math.round((frames / frameRate) * 10) / 10;
}

function timecodeToFrames(timecode: string, frameRate: number): number {
  const [hours, minutes, seconds, frames] = timecode.split(/[:;]/).map(Number);
  // Rounding the frame rate to the nearest integer is necessary to avoid floating point errors
  return Math.floor(
    (hours * 3600 + minutes * 60 + seconds) * Math.round(frameRate) + frames
  );
}

function frameRateToFrameDuration(frameRate: number): string {
  return (
    {
      23.976: '1001/24000s',
      24: '100/2400s',
      25: '1/25s',
      29.97: '1001/30000s',
      30: '1/30s',
      50: '1/50s',
      59.94: '1001/60000s',
      60: '1/60s',
    }[frameRate] || '1001/24000s'
  );
}

function generateFCPXML(
  pathToSource: string,
  sourceClipName: string,
  sourceDuration: number,
  clips: Array<Clip>,
  frameRate: number,
  timecodeInSeconds: number
): string {
  // The root FCPXML element
  const fcpxml: ElementCompact = {
    _declaration: {
      _attributes: {
        version: '1.0',
        encoding: 'UTF-8',
      },
    },
    fcpxml: {
      _attributes: {
        version: '1.10',
      },
      resources: {
        format: {
          _attributes: {
            id: 'r0',
            name: `FFVideoFormat3840x2160p${(Math.round(frameRate * 100) / 100)
              .toString()
              .replace('.', '')}`,
            frameDuration: frameRateToFrameDuration(frameRate),
            width: '3840',
            height: '2160',
          },
        },
        asset: [],
      },
      library: {
        event: {
          _attributes: {
            name: `TurboCut ${sourceClipName}`,
          },
          project: {
            _attributes: {
              name: `TurboCut ${sourceClipName}`,
            },
            sequence: {
              _attributes: {
                tcStart: '0/1s',
                format: 'r0',
                tcFormat: 'NDF',
              },
              spine: {
                'asset-clip': [],
              },
            },
          },
        },
      },
    },
  };

  const [numerator, denominator] = frameRateToFrameDuration(frameRate)
    .split('/')
    .map((n) => parseInt(n, 10));
  const assetId = 'r2';
  const assetStart = numerator * Math.floor(timecodeInSeconds * frameRate);
  const assetDuration = numerator * Math.floor(sourceDuration * frameRate);

  // Add the asset
  fcpxml.fcpxml.resources.asset.push({
    _attributes: {
      id: assetId,
      name: sourceClipName,
      start: `${assetStart}/${denominator}s`,
      duration: `${assetDuration}/${denominator}s`,
      format: 'r1',
      hasAudio: '1',
      audioSources: '1',
      audioChannels: '1',
    },
    'media-rep': {
      _attributes: {
        src: `file://${pathToSource}`,
        kind: 'original-media',
      },
    },
  });

  let offset = 0;

  clips.forEach((clip) => {
    const start =
      numerator * Math.floor((timecodeInSeconds + clip.start) * frameRate);
    const end =
      numerator * Math.floor((timecodeInSeconds + clip.end) * frameRate);
    const duration = end - start;

    // Add the clip to the timeline
    fcpxml.fcpxml.library.event.project.sequence.spine['asset-clip'].push({
      _attributes: {
        offset: `${offset}/${denominator}s`,
        enabled: '1',
        ref: assetId,
        duration: `${duration}/${denominator}s`,
        lane: '2',
        name: sourceClipName,
        start: `${start}/${denominator}s`,
      },
    });

    offset += duration;
  });

  return js2xml(fcpxml, { compact: true, spaces: 4 });
}

function generateEDL(
  title: string,
  sourceClipName: string,
  clips: Array<Clip>,
  frameRate: number,
  timecodeInSeconds: number
): string {
  // The EDL header. The FCM (frame count mode) is set to NON-DROP FRAME.
  let edl = `TITLE: ${title}\nFCM: NON-DROP FRAME\n\n`;

  // recordStartFrames is the number of frames since the beginning of the video
  // at which the next clip should be inserted. It is incremented by the number of frames in each clip.
  let recordStartFrames = 0;
  clips.forEach((clip, index) => {
    // srcStartFrames and srcEndFrames are the start and end frames of the clip in the source video.
    // timecodeInSeconds is the offset of the source video in seconds.
    const srcStartFrames = Math.floor(
      (clip.start + timecodeInSeconds) * frameRate
    );
    const srcEndFrames = Math.floor((clip.end + timecodeInSeconds) * frameRate);
    // recStartFrames and recEndFrames are the start and end frames of the clip in the EDL.
    const recStartFrames = recordStartFrames;
    const recEndFrames = Math.floor(
      recordStartFrames + (clip.end - clip.start) * frameRate
    );

    // "AX" represents an auxiliary track
    // "V" stands for "video"
    // "C" indicates a basic cut transition
    edl += `${String(index + 1).padStart(
      3,
      '0'
    )}  AX       V     C        ${framesToTimecode(
      srcStartFrames,
      frameRate
    )} ${framesToTimecode(srcEndFrames, frameRate)} ${framesToTimecode(
      recStartFrames,
      frameRate
    )} ${framesToTimecode(recEndFrames, frameRate)}\n`;
    edl += `* FROM CLIP NAME: ${sourceClipName}\n\n`;

    // Increment the number of frames since the beginning of the video at which the next clip should be inserted.
    recordStartFrames = recEndFrames;
  });

  return edl;
}

async function getStartTimecode(filePath: string): Promise<string> {
  const probeData = await new Promise<FfprobeData>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  // Duration of the entire file (in seconds)
  const videoStream = probeData.streams.find(
    (stream: any) => stream.codec_type === 'video'
  );
  const qtStream = probeData.streams.find(
    (stream: any) => stream.codec_type === 'data'
  );

  const startTimecodeFormat = probeData.format.tags?.timecode;
  const startTimecodeStream = videoStream?.tags?.timecode;
  const startTimecodeQt = qtStream?.tags?.timecode;
  const startTimecodeStreamStart = videoStream?.start_time;

  return (
    startTimecodeFormat ||
    startTimecodeStream ||
    startTimecodeQt ||
    startTimecodeStreamStart ||
    '00:00:00:00'
  );
}

export async function createFCPXML(
  title: string,
  clips: Array<Clip>,
  videoInfo: VideoInfo,
  clipName: string,
  frameRate: number
): Promise<boolean> {
  // Show the save file dialog and get the user's chosen path
  const result = await dialog.showSaveDialog({
    title,
    defaultPath: `${videoInfo.path.split('/').pop()}.fcpxmld`,
    filters: [{ name: 'FCPXML 1.10', extensions: ['fcpxmld'] }],
  });

  if (result.canceled || result.filePath === undefined) {
    return false;
  }

  const startTimecode = await getStartTimecode(videoInfo.path);

  const startFrame = timecodeToFrames(startTimecode, frameRate);
  const startTimecodeInSeconds = framesToSeconds(startFrame, frameRate);

  const xml = generateFCPXML(
    videoInfo.path,
    clipName,
    videoInfo.duration,
    clips,
    frameRate,
    startTimecodeInSeconds
  );

  try {
    await mkdir(result.filePath!);
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw new Error('Failed to create directory');
    }
  }

  await writeFile(path.join(result.filePath!, 'Info.fcpxml'), xml, 'utf8');

  return true;
}

export async function createEDL(
  title: string,
  clips: Array<Clip>,
  videoInfo: VideoInfo,
  clipName: string,
  frameRate: number
): Promise<boolean> {
  // Show the save file dialog and get the user's chosen path
  const result = await dialog.showSaveDialog({
    title,
    defaultPath: `${videoInfo.path.split('/').pop()}.edl`,
    filters: [{ name: 'EDL', extensions: ['edl'] }],
  });

  if (result.canceled || result.filePath === undefined) {
    return false;
  }

  const startTimecode = await getStartTimecode(videoInfo.path);

  const startFrame = timecodeToFrames(startTimecode, frameRate);
  const startTimecodeInSeconds = framesToSeconds(startFrame, frameRate);

  const edl = generateEDL(
    'Silence Removed',
    clipName,
    clips,
    frameRate,
    startTimecodeInSeconds
  );

  await writeFile(result.filePath!, edl, 'utf8');

  return true;
}
