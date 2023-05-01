import React, { useState } from 'react';
import { InboxOutlined } from '@ant-design/icons';
import Dragger from 'antd/es/upload/Dragger';

import type { RcFile, UploadFile } from 'antd/es/upload/interface';
import { message } from 'antd';
import { CREATE_OPTIMIZED_AUDIO_FILE } from 'renderer/messages';

interface AudioFileInputProps {
  onChange: (file: File) => void;
}

export const AudioFileInput: React.FC<AudioFileInputProps> = ({ onChange }) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const beforeUpload = (file: RcFile): boolean => {
    setFileList([file]);
    onChange(file);

    message.open({
      key: CREATE_OPTIMIZED_AUDIO_FILE,
      type: 'loading',
      content: 'Creating optimized audio file...',
      duration: 0,
    });

    return false;
  };

  return (
    <Dragger
      name="file"
      multiple={false}
      accept="audio/*,video/*"
      beforeUpload={beforeUpload}
      showUploadList={{ showRemoveIcon: false, showDownloadIcon: false }}
      fileList={fileList}
    >
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">
        Click or drag file to this area to upload
      </p>
      <p className="ant-upload-hint">Video or audio files are supported</p>
    </Dragger>
  );
};

export default AudioFileInput;
