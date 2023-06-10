import { FC, useEffect, useRef, useState } from 'react';
import { Col, Row } from 'antd';

import { useProjectConfig } from 'renderer/hooks/useProjectConfig';
import { useExport } from 'renderer/hooks/useExport';

import CutTimeline from 'renderer/components/CutTimeline';
import ExportButton from 'renderer/components/ExportButton';
import TranscriptionEditor from 'renderer/components/TranscriptionEditor';

const Cut: FC = () => {
  const {
    projectConfig: { transcription },
  } = useProjectConfig();
  const { exportTimeline, isExporting } = useExport();
  const [disabledSegmentIds, setDisabledSegmentIds] = useState<Set<number>>(
    new Set()
  );
  const [segmentAtPlayhead, setSegmentAtPlayhead] = useState<number>(0);
  const textRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = textRef.current;
    if (element && element.scrollIntoView) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [segmentAtPlayhead]);

  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const selection = window.getSelection();

        if (!selection) return;

        const segmentsToDelete = new Set<number>();
        const segmentsToAdd = new Set<number>();

        for (let i = 0; i < selection.rangeCount; i++) {
          const range = selection.getRangeAt(i);
          const start =
            range.startContainer.parentElement?.dataset?.segmentId ||
            range.startContainer.parentElement
              ?.closest('[data-segment-id]')
              ?.getAttribute('data-segment-id');
          const end =
            range.endContainer.parentElement?.dataset?.segmentId ||
            range.endContainer.parentElement
              ?.closest('[data-segment-id]')
              ?.getAttribute('data-segment-id');

          if (!start || !end) {
            continue;
          }

          const from = parseInt(start || '-1', 10);
          const to = parseInt(end || '-1', 10);

          if (from !== -1 && to !== -1) {
            for (let j = from; j <= to; j++) {
              if (disabledSegmentIds.has(j)) {
                segmentsToDelete.add(j);
              } else {
                segmentsToAdd.add(j);
              }
            }
          }
        }

        // Merge selectedSegmentIds into disabledSegmentIds
        setDisabledSegmentIds(
          (prevDisabledSegmentIds) =>
            new Set([
              ...Array.from(prevDisabledSegmentIds).filter(
                (id) => !segmentsToDelete.has(id)
              ),
              ...Array.from(segmentsToAdd),
            ])
        );
      }
    };

    window.addEventListener('keyup', handleKeyUp);

    // Cleanup function to remove the event listener
    return () => {
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [disabledSegmentIds]);

  return (
    <>
      <Row justify="center">
        <Col className="col">
          <CutTimeline
            disabledSegmentIds={disabledSegmentIds}
            setSegmentAtPlayhead={(segmentId) => {
              if (segmentId !== null && segmentId !== segmentAtPlayhead) {
                setSegmentAtPlayhead(segmentId);
              }
            }}
          />
        </Col>
      </Row>
      <Row justify="center">
        <Col className="col">
          <TranscriptionEditor
            transcription={transcription}
            segmentAtPlayhead={segmentAtPlayhead}
            disabledSegmentIds={disabledSegmentIds}
            ref={textRef}
          />
          <ExportButton
            handleExport={exportTimeline}
            loading={isExporting}
            disabled={isExporting}
          />
        </Col>
      </Row>
    </>
  );
};

export default Cut;