import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import type { UploadResult } from "@uppy/core";
import type { ImageGeneration } from "@shared/schema";

export default function Home() {
  const [mode, setMode] = useState<"image-to-image" | "text-to-image">("image-to-image");
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string>("");
  const [uploadedImagePath, setUploadedImagePath] = useState<string>("");
  const [prompt, setPrompt] = useState("Make the bubbles heart-shaped");
  const [textPrompt, setTextPrompt] = useState("A beautiful landscape with mountains and a lake at sunset");
  const [guidanceScale, setGuidanceScale] = useState(5.5);
  const [seed, setSeed] = useState(21);
  const [watermark, setWatermark] = useState(true);
  const [size, setSize] = useState("1:1");
  const [currentGenerationId, setCurrentGenerationId] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll for generation status
  const { data: generation, isLoading: isPolling } = useQuery<ImageGeneration>({
    queryKey: ["/api/image-generations", currentGenerationId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/image-generations/${currentGenerationId}`);
      return response.json();
    },
    enabled: !!currentGenerationId,
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't cache data
    refetchInterval: (query) => {
      const gen = query.state.data as ImageGeneration | undefined;
      return (gen?.status === "pending" || gen?.status === "processing") ? 2000 : false;
    },
  });

  const handleGetUploadParameters = async () => {
    console.log("Getting upload parameters...");
    const response = await apiRequest("POST", "/api/objects/upload");
    const data = await response.json();
    console.log("Upload parameters:", data);
    return {
      method: "PUT" as const,
      url: data.uploadURL,
    };
  };

  const handleUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    console.log("Upload complete result:", result);
    
    if (result.successful && result.successful[0]) {
      const uploadURL = result.successful[0].uploadURL;
      console.log("Upload URL:", uploadURL);
      
      try {
        const response = await apiRequest("PUT", "/api/objects/set-path", {
          imageURL: uploadURL,
        });
        const data = await response.json();
        console.log("Set path response:", data);
        
        setUploadedImageUrl(data.objectPath); // Use our backend proxy path
        setUploadedImagePath(data.objectPath);
        toast({
          title: "Image uploaded successfully",
          description: "You can now generate AI edits.",
        });
      } catch (error) {
        console.error("Error setting object path:", error);
        toast({
          title: "Upload error",
          description: "Failed to process uploaded image.",
          variant: "destructive",
        });
      }
    } else {
      console.error("Upload failed:", result);
      toast({
        title: "Upload failed",
        description: "Failed to upload image.",
        variant: "destructive",
      });
    }
  };

  const generateMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/image-generations", data);
      return response.json();
    },
    onSuccess: (data: ImageGeneration) => {
      setCurrentGenerationId(data.id);
      // Invalidate any existing cache for this generation
      queryClient.invalidateQueries({ queryKey: ["/api/image-generations", data.id] });
      toast({
        title: "Generation started",
        description: "Your image is being processed...",
      });
    },
    onError: (error) => {
      console.error("Generation error:", error);
      toast({
        title: "Generation failed",
        description: "Failed to start image generation.",
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    if (mode === "image-to-image") {
      if (!uploadedImagePath || !prompt.trim()) {
        toast({
          title: "Missing information",
          description: "Please upload an image and enter a prompt.",
          variant: "destructive",
        });
        return;
      }

      generateMutation.mutate({
        type: "image-to-image",
        originalImageUrl: uploadedImagePath,
        prompt: prompt.trim(),
        guidanceScale,
        seed,
        watermark,
      });
    } else {
      if (!textPrompt.trim()) {
        toast({
          title: "Missing prompt",
          description: "Please enter a text prompt for image generation.",
          variant: "destructive",
        });
        return;
      }

      generateMutation.mutate({
        type: "text-to-image",
        prompt: textPrompt.trim(),
        guidanceScale,
        seed,
        watermark,
        size,
      });
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Create a preview URL
      const previewUrl = URL.createObjectURL(file);
      setUploadedImageUrl(previewUrl);
      
      // TODO: Handle actual upload through ObjectUploader
      toast({
        title: "File selected",
        description: "Please use the upload button to upload your image.",
      });
    }
  };

  const removeImage = () => {
    setUploadedImageUrl("");
    setUploadedImagePath("");
    setCurrentGenerationId("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isGenerating = generateMutation.isPending || (generation?.status === "pending" || generation?.status === "processing");

  return (
    <div className="bg-background min-h-screen font-inter">
      {/* Header */}
      <header className="bg-surface shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <i className="fas fa-magic text-white text-sm"></i>
              </div>
              <h1 className="text-xl font-semibold text-secondary">AI Image Editor</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">Powered by BytePlus</span>
              <button className="text-secondary hover:text-primary transition-colors">
                <i className="fas fa-question-circle"></i>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Mode Selection */}
          <Card className="bg-surface rounded-xl shadow-sm border border-gray-200">
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold text-secondary mb-4 flex items-center">
                <i className="fas fa-magic text-primary mr-2"></i>
                Choose Generation Mode
              </h2>
              <div className="flex space-x-4">
                <button
                  onClick={() => setMode("image-to-image")}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all duration-200 ${
                    mode === "image-to-image"
                      ? "border-primary bg-blue-50 text-primary"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                  data-testid="mode-image-to-image"
                >
                  <div className="text-center">
                    <i className="fas fa-image text-2xl mb-2"></i>
                    <div className="font-semibold">Image to Image</div>
                    <div className="text-sm opacity-80">Edit existing images with AI</div>
                  </div>
                </button>
                <button
                  onClick={() => setMode("text-to-image")}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all duration-200 ${
                    mode === "text-to-image"
                      ? "border-primary bg-blue-50 text-primary"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                  data-testid="mode-text-to-image"
                >
                  <div className="text-center">
                    <i className="fas fa-pencil-alt text-2xl mb-2"></i>
                    <div className="font-semibold">Text to Image</div>
                    <div className="text-sm opacity-80">Create images from text descriptions</div>
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Input Section */}
          {mode === "image-to-image" ? (
            <Card className="bg-surface rounded-xl shadow-sm border border-gray-200">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-secondary mb-4 flex items-center">
                  <i className="fas fa-upload text-primary mr-2"></i>
                  Upload Your Image
                </h2>
              
              {!uploadedImageUrl ? (
                <div className="space-y-4">
                  <div 
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer bg-gray-50 hover:bg-blue-50"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="drop-zone"
                  >
                    <div className="space-y-4">
                      <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                        <i className="fas fa-cloud-upload-alt text-primary text-2xl"></i>
                      </div>
                      <div>
                        <p className="text-lg font-medium text-secondary">Drop your image here</p>
                        <p className="text-sm text-gray-500 mt-1">or <span className="text-primary font-medium">browse files</span></p>
                      </div>
                      <p className="text-xs text-gray-400">Supports JPG, PNG up to 10MB</p>
                    </div>
                  </div>
                  
                  <div className="flex justify-center">
                    <ObjectUploader
                      maxNumberOfFiles={1}
                      maxFileSize={10485760}
                      onGetUploadParameters={handleGetUploadParameters}
                      onComplete={handleUploadComplete}
                      buttonClassName="bg-primary hover:bg-blue-800 text-white px-6 py-3 rounded-lg font-medium"
                    >
                      <div className="flex items-center gap-2">
                        <i className="fas fa-upload"></i>
                        <span>Upload Image</span>
                      </div>
                    </ObjectUploader>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={handleFileInputChange}
                    data-testid="file-input"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-secondary">Selected Image:</span>
                    <button 
                      className="text-red-500 hover:text-red-700 text-sm"
                      onClick={removeImage}
                      data-testid="button-remove-image"
                    >
                      <i className="fas fa-times mr-1"></i>Remove
                    </button>
                  </div>
                  <div className="relative bg-gray-100 rounded-lg overflow-hidden">
                    <img 
                      src={uploadedImageUrl} 
                      alt="Uploaded image" 
                      className="w-full h-48 object-cover" 
                      data-testid="img-uploaded-preview"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          ) : (
            <Card className="bg-surface rounded-xl shadow-sm border border-gray-200">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-secondary mb-4 flex items-center">
                  <i className="fas fa-pencil-alt text-primary mr-2"></i>
                  Text to Image Generation
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="textPromptInput" className="text-sm font-medium text-secondary">
                      Describe the image you want to create
                    </Label>
                    <Textarea 
                      id="textPromptInput"
                      rows={4}
                      className="mt-2 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                      placeholder="e.g., A beautiful landscape with mountains and a lake at sunset, realistic style, high quality..."
                      value={textPrompt}
                      onChange={(e) => setTextPrompt(e.target.value)}
                      data-testid="textarea-text-prompt"
                    />
                    <p className="text-xs text-gray-500 mt-1">Be detailed and specific about what you want to see in the generated image</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-secondary">Image Size</Label>
                      <select 
                        value={size} 
                        onChange={(e) => setSize(e.target.value)}
                        className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        data-testid="select-size"
                      >
                        <option value="1:1">1:1 (Square)</option>
                        <option value="3:4">3:4 (Portrait)</option>
                        <option value="4:3">4:3 (Landscape)</option>
                        <option value="16:9">16:9 (Wide Landscape)</option>
                        <option value="9:16">9:16 (Tall Portrait)</option>
                        <option value="2:3">2:3 (Portrait)</option>
                        <option value="3:2">3:2 (Landscape)</option>
                        <option value="21:9">21:9 (Ultra Wide)</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-secondary">Guidance Scale</Label>
                      <Input 
                        type="number" 
                        min="1" 
                        max="20" 
                        value={guidanceScale} 
                        step="0.5"
                        className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                        data-testid="input-guidance-scale"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Prompt Section for Image-to-Image */}
          {mode === "image-to-image" && (
          <Card className="bg-surface rounded-xl shadow-sm border border-gray-200">
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold text-secondary mb-4 flex items-center">
                <i className="fas fa-edit text-primary mr-2"></i>
                Describe Your Modifications
              </h2>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="promptInput" className="text-sm font-medium text-secondary">
                    What changes would you like to make?
                  </Label>
                  <Textarea 
                    id="promptInput"
                    rows={3}
                    className="mt-2 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                    placeholder="e.g., Make the bubbles heart-shaped, change the sky to sunset colors, add flying birds..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    data-testid="textarea-prompt"
                  />
                  <p className="text-xs text-gray-500 mt-1">Be specific about the changes you want to see in your image</p>
                </div>

                {/* Advanced Options */}
                <details className="group" open={showAdvanced}>
                  <summary 
                    className="cursor-pointer text-sm font-medium text-primary hover:text-blue-800 flex items-center"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    data-testid="button-advanced-settings"
                  >
                    <i className="fas fa-cog mr-2"></i>
                    Advanced Settings
                    <i className="fas fa-chevron-down ml-2 transform group-open:rotate-180 transition-transform"></i>
                  </summary>
                  <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium text-secondary">Guidance Scale</Label>
                        <Input 
                          type="range" 
                          min="1" 
                          max="20" 
                          value={guidanceScale} 
                          step="0.5"
                          className="mt-2 w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                          onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                          data-testid="slider-guidance-scale"
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>1.0</span>
                          <span data-testid="text-guidance-scale">{guidanceScale}</span>
                          <span>20.0</span>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-secondary">Seed</Label>
                        <Input 
                          type="number" 
                          value={seed} 
                          min="0" 
                          max="999999"
                          className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                          onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                          data-testid="input-seed"
                        />
                        <p className="text-xs text-gray-500 mt-1">For reproducible results</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="watermark" 
                        checked={watermark}
                        onCheckedChange={(checked) => setWatermark(checked as boolean)}
                        data-testid="checkbox-watermark"
                      />
                      <Label htmlFor="watermark" className="text-sm text-secondary">Include watermark</Label>
                    </div>
                  </div>
                </details>
              </div>
            </CardContent>
          </Card>
          )}

          {/* Generate Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleGenerate}
              disabled={
                (mode === "image-to-image" && (!uploadedImagePath || !prompt.trim())) ||
                (mode === "text-to-image" && !textPrompt.trim()) ||
                isGenerating
              }
              className="bg-primary hover:bg-blue-800 text-white font-semibold px-8 py-4 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center space-x-3"
              data-testid="button-generate"
            >
              <i className="fas fa-magic"></i>
              <span>
                {isGenerating 
                  ? "Generating..." 
                  : mode === "text-to-image" 
                    ? "Generate Image" 
                    : "Generate AI Edit"
                }
              </span>
            </Button>
          </div>

          {/* Loading State */}
          {isGenerating && (
            <Card className="bg-surface rounded-xl shadow-sm border border-gray-200" data-testid="loading-state">
              <CardContent className="p-8">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 mx-auto">
                    <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary border-t-transparent"></div>
                  </div>
                  <h3 className="text-lg font-semibold text-secondary">Processing Your Image</h3>
                  <p className="text-gray-500">This may take a few moments...</p>
                  <div className="w-full bg-gray-200 rounded-full h-2 max-w-md mx-auto">
                    <div className="bg-primary h-2 rounded-full animate-pulse" style={{width: "45%"}}></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error State */}
          {generation?.status === "failed" && (
            <Card className="bg-red-50 border border-red-200 rounded-xl" data-testid="error-state">
              <CardContent className="p-6">
                <div className="flex items-start space-x-3">
                  <i className="fas fa-exclamation-circle text-red-500 mt-1"></i>
                  <div className="flex-1">
                    <h3 className="text-red-800 font-semibold">Generation Failed</h3>
                    <p className="text-red-700 text-sm mt-1" data-testid="text-error-message">
                      {generation.errorMessage || "Unable to process your image. Please try again."}
                    </p>
                    <Button 
                      variant="ghost"
                      className="mt-3 text-primary hover:text-blue-800 text-sm font-medium p-0 h-auto"
                      onClick={handleGenerate}
                      data-testid="button-retry"
                    >
                      <i className="fas fa-redo mr-1"></i>
                      Try Again
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results Section */}
          {generation?.status === "completed" && generation.generatedImageUrl && (
            <Card className="bg-surface rounded-xl shadow-sm border border-gray-200" data-testid="results-section">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-secondary mb-6 flex items-center">
                  <i className="fas fa-images text-primary mr-2"></i>
                  Before & After Comparison
                </h2>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Original Image */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-secondary flex items-center">
                      <i className="fas fa-image text-gray-500 mr-2"></i>
                      Original Image
                    </h3>
                    <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square">
                      <img 
                        src={uploadedImageUrl} 
                        alt="Original image" 
                        className="w-full h-full object-cover" 
                        data-testid="img-original"
                      />
                    </div>
                  </div>

                  {/* Generated Image */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-secondary flex items-center">
                      <i className="fas fa-sparkles text-accent mr-2"></i>
                      AI Generated Result
                    </h3>
                    <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative">
                      <img 
                        src={generation.generatedImageUrl} 
                        alt="AI generated result" 
                        className="w-full h-full object-cover" 
                        data-testid="img-generated"
                      />
                      <div className="absolute top-3 right-3">
                        <span className="bg-accent text-white text-xs px-2 py-1 rounded-full font-medium">NEW</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-6 flex flex-wrap gap-3 justify-center">
                  <Button 
                    className="bg-primary hover:bg-blue-800 text-white px-6 py-2 rounded-lg font-medium"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = generation.generatedImageUrl!;
                      link.download = `ai-generated-${generation.id}.jpg`;
                      link.click();
                    }}
                    data-testid="button-download"
                  >
                    <i className="fas fa-download mr-2"></i>
                    Download Result
                  </Button>
                  <Button 
                    variant="secondary"
                    className="bg-gray-100 hover:bg-gray-200 text-secondary px-6 py-2 rounded-lg font-medium"
                    onClick={handleGenerate}
                    data-testid="button-generate-again"
                  >
                    <i className="fas fa-redo mr-2"></i>
                    Generate Again
                  </Button>
                  <Button 
                    variant="secondary"
                    className="bg-gray-100 hover:bg-gray-200 text-secondary px-6 py-2 rounded-lg font-medium"
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({
                          title: 'AI Generated Image',
                          url: generation.generatedImageUrl!
                        });
                      }
                    }}
                    data-testid="button-share"
                  >
                    <i className="fas fa-share-alt mr-2"></i>
                    Share
                  </Button>
                </div>

                {/* Generation Details */}
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-primary flex items-center" data-testid="button-generation-details">
                      <i className="fas fa-info-circle mr-2"></i>
                      Generation Details
                      <i className="fas fa-chevron-down ml-2 transform group-open:rotate-180 transition-transform"></i>
                    </summary>
                    <div className="mt-3 text-sm text-gray-600 space-y-2">
                      <div className="flex justify-between">
                        <span>Model:</span>
                        <span className="font-mono text-xs" data-testid="text-model">ep-20250824201751-nm8dh</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Prompt:</span>
                        <span data-testid="text-used-prompt">"{generation.prompt}"</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Guidance Scale:</span>
                        <span data-testid="text-used-guidance-scale">{generation.guidanceScale}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Seed:</span>
                        <span data-testid="text-used-seed">{generation.seed}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Processing Time:</span>
                        <span data-testid="text-processing-time">{generation.processingTime?.toFixed(1)}s</span>
                      </div>
                    </div>
                  </details>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-gray-200 bg-surface">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center space-y-4">
            <div className="flex justify-center items-center space-x-6 text-sm text-gray-500">
              <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-primary transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-primary transition-colors">API Documentation</a>
              <a href="#" className="hover:text-primary transition-colors">Support</a>
            </div>
            <p className="text-xs text-gray-400">
              Powered by BytePlus AI Image Generation API • Made with ❤️ for creators
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
