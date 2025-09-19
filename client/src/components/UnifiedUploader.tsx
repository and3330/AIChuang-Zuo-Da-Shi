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

  // Initialize Uppy instance
  const [uppy] = useState(() =>
    new Uppy({
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
      })
      .on("upload-error", (file, error) => {
        setIsUploading(false);
        setUploadProgress(0);
        setSelectedFile(null);
        onError?.(error);
      })
  );

  const validateFile = useCallback((file: File): { valid: boolean; error?: string } => {
    // Check file type
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      return { valid: false, error: "Only JPG and PNG files are supported" };
    }

    // Check file size
    if (file.size > maxFileSize) {
      const maxSizeMB = Math.round(maxFileSize / (1024 * 1024));
      return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
    }

    return { valid: true };
  }, [maxFileSize]);

  const handleFileSelection = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const file = fileArray[0]; // Take only the first file for single upload
    const validation = validateFile(file);

    if (!validation.valid) {
      onError?.(new Error(validation.error || "Invalid file"));
      return;
    }

    setSelectedFile(file);
    
    // Add file to Uppy and start upload
    try {
      uppy.addFile({
        name: file.name,
        type: file.type,
        data: file,
        source: "unified-uploader",
      });
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error("Upload failed"));
    }
  }, [uppy, validateFile, onError]);

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
                  Uploading {selectedFile?.name}...
                </p>
                <div className="max-w-xs mx-auto">
                  <Progress value={uploadProgress} className="h-2" />
                </div>
                <p className="text-sm text-gray-500">
                  {Math.round(uploadProgress)}% complete
                  {selectedFile && ` • ${formatFileSize(selectedFile.size)}`}
                </p>
              </div>
            ) : isDragOver ? (
              <div>
                <p className="text-lg font-medium text-primary">Drop your image here</p>
                <p className="text-sm text-blue-600 mt-1">Release to upload</p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-medium text-secondary">
                  {children || "Drop your image here or click to browse"}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  <span className="text-primary font-medium">Click to browse</span> or drag and drop
                </p>
              </div>
            )}
          </div>

          {/* File Constraints */}
          {!isUploading && (
            <p className="text-xs text-gray-400">
              Supports JPG, PNG up to {Math.round(maxFileSize / (1024 * 1024))}MB
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
        onChange={handleFileInputChange}
        data-testid="unified-file-input"
      />
    </div>
  );
}