import { useState, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface UnifiedUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>
  ) => void;
  onError?: (error: Error) => void;
  className?: string;
  children?: ReactNode;
}

/**
 * A unified file upload component that provides both drag-and-drop and click-to-browse functionality
 * in a single, seamless interface.
 * 
 * Features:
 * - Drag and drop files directly onto the component
 * - Click to browse and select files
 * - Real-time upload progress feedback
 * - Visual feedback during drag operations
 * - File validation (type and size)
 * - Error handling with user-friendly messages
 * 
 * The component uses Uppy under the hood for reliable file uploads with progress tracking.
 */
export function UnifiedUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  onGetUploadParameters,
  onComplete,
  onError,
  className = "",
  children,
}: UnifiedUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const uppyRef = useRef<InstanceType<typeof Uppy> | null>(null);

  // Initialize Uppy instance
  const [uppy] = useState(() => {
    const instance = new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes: ["image/jpeg", "image/png"],
      },
      autoProceed: true,
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: onGetUploadParameters,
      })
      .on("upload", () => {
        setIsUploading(true);
        setUploadProgress(0);
      })
      .on("upload-progress", (file, progress) => {
        if (progress.bytesTotal && progress.bytesTotal > 0) {
          const percentage = (progress.bytesUploaded / progress.bytesTotal) * 100;
          setUploadProgress(percentage);
        }
      })
      .on("upload-success", () => {
        setUploadProgress(100);
      })
      .on("complete", (result) => {
        setIsUploading(false);
        setUploadProgress(0);
        setSelectedFile(null);
        onComplete?.(result);
        // Clear all tracked files so next batch upload works correctly
        uppyRef.current?.getFiles().forEach(f => uppyRef.current?.removeFile(f.id));
      })
      .on("upload-error", (file, error) => {
        setIsUploading(false);
        setUploadProgress(0);
        setSelectedFile(null);
        onError?.(error);
      });
    uppyRef.current = instance;
    return instance;
  });

  const validateFile = useCallback((file: File): { valid: boolean; error?: string } => {
    // Check file type
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      return { valid: false, error: "僅支援 JPG 和 PNG 檔案格式" };
    }

    // Check file size
    if (file.size > maxFileSize) {
      const maxSizeMB = Math.round(maxFileSize / (1024 * 1024));
      return { valid: false, error: `檔案大小必須小於 ${maxSizeMB}MB` };
    }

    return { valid: true };
  }, [maxFileSize]);

  const handleFileSelection = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, maxNumberOfFiles);
    if (fileArray.length === 0) return;

    for (const file of fileArray) {
      const validation = validateFile(file);
      if (!validation.valid) {
        onError?.(new Error(validation.error || "Invalid file"));
        return;
      }
    }

    setSelectedFile(fileArray[0]);

    // Add all files to Uppy and start upload
    try {
      for (const file of fileArray) {
        uppy.addFile({
          name: file.name,
          type: file.type,
          data: file,
          source: "unified-uploader",
        });
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error("Upload failed"));
    }
  }, [uppy, validateFile, onError, maxNumberOfFiles]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelection(files);
    }
  }, [handleFileSelection]);

  // Click handler
  const handleClick = useCallback(() => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  }, [isUploading]);

  // File input change handler
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files);
    }
  }, [handleFileSelection]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className={`relative ${className}`}>
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 cursor-pointer
          ${isDragOver 
            ? "border-primary bg-blue-50 border-blue-400" 
            : isUploading
            ? "border-blue-300 bg-blue-25"
            : "border-gray-300 bg-gray-50 hover:border-primary hover:bg-blue-50"
          }
          ${isUploading ? "pointer-events-none" : ""}
        `}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        data-testid="unified-upload-zone"
      >
        <div className="space-y-4">
          {/* Upload Icon */}
          <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center transition-colors ${
            isDragOver ? "bg-primary/20" : "bg-primary/10"
          }`}>
            {isUploading ? (
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <i className={`fas fa-cloud-upload-alt text-2xl transition-colors ${
                isDragOver ? "text-primary" : "text-primary"
              }`} />
            )}
          </div>

          {/* Upload Text */}
          <div>
            {isUploading ? (
              <div className="space-y-2">
                <p className="text-lg font-medium text-secondary">
                  正在上傳 {selectedFile?.name}...
                </p>
                <div className="max-w-xs mx-auto">
                  <Progress value={uploadProgress} className="h-2" />
                </div>
                <p className="text-sm text-gray-500">
                  已完成 {Math.round(uploadProgress)}%
                  {selectedFile && ` • ${formatFileSize(selectedFile.size)}`}
                </p>
              </div>
            ) : isDragOver ? (
              <div>
                <p className="text-lg font-medium text-primary">將圖片放到這裡</p>
                <p className="text-sm text-blue-600 mt-1">放開以上傳</p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-medium text-secondary">
                  {children || "拖放圖片到此處或點擊瀏覽"}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  <span className="text-primary font-medium">點擊瀏覽</span> 或拖放檔案
                </p>
              </div>
            )}
          </div>

          {/* File Constraints */}
          {!isUploading && (
            <p className="text-xs text-gray-400">
              支援 JPG、PNG 格式，最大 {Math.round(maxFileSize / (1024 * 1024))}MB
            </p>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        multiple={maxNumberOfFiles > 1}
        onChange={handleFileInputChange}
        data-testid="unified-file-input"
      />
    </div>
  );
}