import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { UnifiedUploader } from "@/components/UnifiedUploader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
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
  const [size, setSize] = useState("2K");
  const [currentGenerationId, setCurrentGenerationId] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(2);
  const [batchPrompts, setBatchPrompts] = useState<string[]>(["Make the bubbles heart-shaped", "Change the sky to sunset colors"]);
  const [currentBatchId, setCurrentBatchId] = useState<string>("");
  const [batchGenerations, setBatchGenerations] = useState<ImageGeneration[]>([]);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch statistics
  const { data: stats } = useQuery<{ totalGenerations: number; totalCost: number }>({
    queryKey: ["/api/stats"],
    refetchInterval: 5000, // Refresh stats every 5 seconds
  });

  // Poll for generation status (single generation)
  const { data: generation, isLoading: isPolling } = useQuery<ImageGeneration>({
    queryKey: ["/api/image-generations", currentGenerationId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/image-generations/${currentGenerationId}`);
      return response.json();
    },
    enabled: !!currentGenerationId && !currentBatchId,
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't cache data
    refetchInterval: (query) => {
      const gen = query.state.data as ImageGeneration | undefined;
      return (gen?.status === "pending" || gen?.status === "processing") ? 2000 : false;
    },
  });

  // Poll for batch generation status
  const { data: batchData, isLoading: isBatchPolling } = useQuery<{
    batchId: string;
    generations: ImageGeneration[];
    totalCount: number;
    completedCount: number;
    failedCount: number;
    totalCost: number;
  }>({
    queryKey: ["/api/batch-generations", currentBatchId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/batch-generations/${currentBatchId}`);
      return response.json();
    },
    enabled: !!currentBatchId,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasProcessing = data?.generations.some(g => g.status === "pending" || g.status === "processing");
      return hasProcessing ? 2000 : false;
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
    onSuccess: (data: any) => {
      if (data.batchId) {
        // Batch generation response
        setCurrentBatchId(data.batchId);
        setCurrentGenerationId("");
        setBatchGenerations(data.generations);
        // Invalidate batch cache
        queryClient.invalidateQueries({ queryKey: ["/api/batch-generations", data.batchId] });
        toast({
          title: "Batch generation started",
          description: `Processing ${data.totalCount} images...`,
        });
      } else {
        // Single generation response
        setCurrentGenerationId(data.id);
        setCurrentBatchId("");
        // Invalidate any existing cache for this generation
        queryClient.invalidateQueries({ queryKey: ["/api/image-generations", data.id] });
        toast({
          title: "Generation started",
          description: "Your image is being processed...",
        });
      }
      // Invalidate stats to update the count and cost
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
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

  // Helper functions for batch mode
  const updateBatchPrompt = (index: number, value: string) => {
    const newPrompts = [...batchPrompts];
    newPrompts[index] = value;
    setBatchPrompts(newPrompts);
  };

  const updateBatchCount = (count: number) => {
    setBatchCount(count);
    const newPrompts = [...batchPrompts];
    
    if (count > newPrompts.length) {
      // Add more prompts
      for (let i = newPrompts.length; i < count; i++) {
        newPrompts.push(`Variation ${i + 1}`);
      }
    } else {
      // Remove excess prompts
      newPrompts.splice(count);
    }
    
    setBatchPrompts(newPrompts);
  };

  const handleGenerate = () => {
    if (mode === "image-to-image") {
      if (!uploadedImagePath) {
        toast({
          title: "Missing image",
          description: "Please upload an image first.",
          variant: "destructive",
        });
        return;
      }

      if (isBatchMode) {
        // Batch generation
        const validPrompts = batchPrompts.filter(p => p.trim());
        if (validPrompts.length < 2) {
          toast({
            title: "Missing prompts",
            description: "Please enter at least 2 prompts for batch generation.",
            variant: "destructive",
          });
          return;
        }

        generateMutation.mutate({
          type: "image-to-image",
          originalImageUrl: uploadedImagePath,
          prompts: validPrompts,
          guidanceScale,
          seed,
          watermark,
        });
      } else {
        // Single generation
        if (!prompt.trim()) {
          toast({
            title: "Missing prompt",
            description: "Please enter a prompt.",
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
      }
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

  const handleUploadError = (error: Error) => {
    console.error("Upload error:", error);
    toast({
      title: "Upload failed",
      description: error.message || "Failed to upload image.",
      variant: "destructive",
    });
  };

  const removeImage = () => {
    setUploadedImageUrl("");
    setUploadedImagePath("");
    setCurrentGenerationId("");
    setCurrentBatchId("");
    setBatchGenerations([]);
  };

  const isGenerating = generateMutation.isPending || 
    (generation?.status === "pending" || generation?.status === "processing") ||
    (batchData?.generations.some(g => g.status === "pending" || g.status === "processing"));

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
          {/* Cost Statistics Card */}
          <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl shadow-sm">
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center">
                    <i className="fas fa-images text-primary text-xl"></i>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Images Generated</p>
                    <p className="text-2xl font-bold text-secondary" data-testid="text-total-generations">
                      {stats?.totalGenerations ?? 0}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center">
                    <i className="fas fa-dollar-sign text-green-600 text-xl"></i>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Cost</p>
                    <p className="text-2xl font-bold text-secondary" data-testid="text-total-cost">
                      ${(stats?.totalCost ?? 0).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">$0.03 per image</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
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
                <UnifiedUploader
                  maxNumberOfFiles={1}
                  maxFileSize={10485760}
                  onGetUploadParameters={handleGetUploadParameters}
                  onComplete={handleUploadComplete}
                  onError={handleUploadError}
                  className="w-full"
                >
                  Drop your image here or click to browse
                </UnifiedUploader>
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
                        <option value="2K">2K 高清 (推薦)</option>
                        <option value="4K">4K 超高清</option>
                        <option value="1:1">1:1 正方形 (1920x1920)</option>
                        <option value="16:9">16:9 橫向 (2560x1440)</option>
                        <option value="9:16">9:16 直向 (1440x2560)</option>
                        <option value="4:3">4:3 橫向 (2240x1680)</option>
                        <option value="3:4">3:4 直向 (1680x2240)</option>
                        <option value="3:2">3:2 橫向 (2400x1600)</option>
                        <option value="2:3">2:3 直向 (1600x2400)</option>
                        <option value="21:9">21:9 超寬 (3360x1440)</option>
                        <option value="A4">A4 列印 (2480x3508)</option>
                        <option value="A5">A5 列印 (1920x2720)</option>
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
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-secondary flex items-center">
                  <i className="fas fa-edit text-primary mr-2"></i>
                  Describe Your Modifications
                </h2>
                
                {/* Batch Mode Toggle */}
                <div className="flex items-center space-x-3">
                  <Label htmlFor="batchToggle" className="text-sm font-medium text-secondary">
                    Batch Generation
                  </Label>
                  <input
                    id="batchToggle"
                    type="checkbox"
                    checked={isBatchMode}
                    onChange={(e) => {
                      setIsBatchMode(e.target.checked);
                      if (e.target.checked) {
                        updateBatchCount(batchCount); // Initialize batch prompts
                      }
                    }}
                    className="w-4 h-4 text-primary bg-gray-100 border-gray-300 rounded focus:ring-primary focus:ring-2"
                    data-testid="checkbox-batch-mode"
                  />
                </div>
              </div>
              
              <div className="space-y-4">
                {!isBatchMode ? (
                  /* Single Generation Mode */
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
                ) : (
                  /* Batch Generation Mode */
                  <div className="space-y-4">
                    {/* Batch Count Selection */}
                    <div>
                      <Label className="text-sm font-medium text-secondary mb-2 block">
                        How many images would you like to generate?
                      </Label>
                      <div className="flex items-center space-x-4">
                        <Input
                          type="number"
                          min="2"
                          max="10"
                          value={batchCount}
                          onChange={(e) => {
                            const count = parseInt(e.target.value) || 2;
                            updateBatchCount(Math.min(Math.max(count, 2), 10));
                          }}
                          className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                          data-testid="input-batch-count"
                        />
                        <span className="text-sm text-gray-500">images (2-10)</span>
                        <div className="text-sm text-gray-600">
                          Total cost: <span className="font-semibold text-primary" data-testid="text-batch-cost">${(batchCount * 0.03).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Dynamic Prompt Fields */}
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-secondary">
                        Describe each variation:
                      </Label>
                      {batchPrompts.slice(0, batchCount).map((batchPrompt, index) => (
                        <div key={index}>
                          <Label className="text-xs text-gray-600 mb-1 block">
                            Image {index + 1} description:
                          </Label>
                          <Textarea
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none text-sm"
                            placeholder={`e.g., ${index === 0 ? 'Make the bubbles heart-shaped' : index === 1 ? 'Change the sky to sunset colors' : `Variation ${index + 1}`}`}
                            value={batchPrompt}
                            onChange={(e) => updateBatchPrompt(index, e.target.value)}
                            data-testid={`textarea-batch-prompt-${index}`}
                          />
                        </div>
                      ))}
                      <p className="text-xs text-gray-500">Each image will be generated with its specific description while keeping the same base image and settings</p>
                    </div>
                  </div>
                )}

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
                (mode === "image-to-image" && !uploadedImagePath) ||
                (mode === "image-to-image" && !isBatchMode && !prompt.trim()) ||
                (mode === "image-to-image" && isBatchMode && batchPrompts.filter(p => p.trim()).length < 2) ||
                (mode === "text-to-image" && !textPrompt.trim()) ||
                isGenerating
              }
              className="bg-primary hover:bg-blue-800 text-white font-semibold px-8 py-4 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center space-x-3"
              data-testid="button-generate"
            >
              <i className="fas fa-magic"></i>
              <span>
                {isGenerating 
                  ? (isBatchMode && mode === "image-to-image" ? `Generating ${batchCount} images...` : "Generating...") 
                  : mode === "text-to-image" 
                    ? "Generate Image" 
                    : isBatchMode 
                      ? `Generate ${batchCount} AI Edits` 
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
                  <div className="flex-1 space-y-3">
                    <div>
                      <h3 className="text-red-800 font-semibold">Generation Failed</h3>
                      <p className="text-red-700 text-sm mt-2" data-testid="text-error-message">
                        {generation.errorMessage || "Unable to process your image. Please try again."}
                      </p>
                    </div>
                    <div>
                      <Button 
                        variant="ghost"
                        className="text-primary hover:text-blue-800 text-sm font-medium p-0 h-auto"
                        onClick={handleGenerate}
                        data-testid="button-retry"
                      >
                        <i className="fas fa-redo mr-1"></i>
                        Try Again
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results Section - Single Generation */}
          {generation?.status === "completed" && generation.generatedImageUrl && !currentBatchId && (
            <Card className="bg-surface rounded-xl shadow-sm border border-gray-200" data-testid="results-section">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-secondary mb-6 flex items-center">
                  <i className="fas fa-images text-primary mr-2"></i>
                  {generation.type === "text-to-image" ? "Generated Result" : "Before & After Comparison"}
                </h2>
                
                {generation.type === "text-to-image" ? (
                  /* Text-to-Image Layout: Single centered image */
                  <div className="flex justify-center">
                    <div className="w-full max-w-2xl space-y-3">
                      <h3 className="text-sm font-medium text-secondary flex items-center justify-center">
                        <i className="fas fa-sparkles text-accent mr-2"></i>
                        AI Generated Image
                      </h3>
                      <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                        <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
                          <DialogTrigger asChild>
                            <div 
                              className="relative cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-lg"
                              onClick={() => setIsLightboxOpen(true)}
                              data-testid="lightbox-trigger"
                              role="button"
                              tabIndex={0}
                              aria-label="Click to view full-size image"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setIsLightboxOpen(true);
                                }
                              }}
                            >
                              <img 
                                src={generation.generatedImageUrl} 
                                alt="AI generated result" 
                                className="w-full h-full object-cover transition-all duration-200" 
                                data-testid="img-generated"
                              />
                              {/* Zoom icon overlay */}
                              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white bg-opacity-90 rounded-full p-3 transform scale-75 group-hover:scale-100 transition-transform">
                                  <i className="fas fa-search-plus text-gray-700 text-xl" aria-hidden="true"></i>
                                </div>
                              </div>
                              {/* NEW badge */}
                              <div className="absolute top-3 right-3 z-10">
                                <span className="bg-accent text-white text-xs px-2 py-1 rounded-full font-medium">NEW</span>
                              </div>
                            </div>
                          </DialogTrigger>
                          <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-transparent border-0 shadow-none">
                            <div className="relative flex items-center justify-center w-full h-full">
                              <img 
                                src={generation.generatedImageUrl} 
                                alt="AI generated result - Full size" 
                                className="max-w-full max-h-[95vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
                                data-testid="img-lightbox"
                              />
                              {/* Close button - positioned outside the image */}
                              <button
                                onClick={() => setIsLightboxOpen(false)}
                                className="absolute top-4 right-4 bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 hover:text-gray-900 rounded-full p-2 transition-all duration-200 shadow-lg z-10"
                                aria-label="Close lightbox"
                                data-testid="button-close-lightbox"
                              >
                                <i className="fas fa-times text-lg" aria-hidden="true"></i>
                              </button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Image-to-Image Layout: Before & After grid */
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Original Image */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-secondary flex items-center">
                        <i className="fas fa-image text-gray-500 mr-2"></i>
                        Original Image
                      </h3>
                      <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square">
                        <img 
                          src={generation.originalImageUrl || uploadedImageUrl} 
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
                      <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                        <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
                          <DialogTrigger asChild>
                            <div 
                              className="relative cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-lg"
                              onClick={() => setIsLightboxOpen(true)}
                              data-testid="lightbox-trigger"
                              role="button"
                              tabIndex={0}
                              aria-label="Click to view full-size image"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setIsLightboxOpen(true);
                                }
                              }}
                            >
                              <img 
                                src={generation.generatedImageUrl} 
                                alt="AI generated result" 
                                className="w-full h-full object-cover transition-all duration-200" 
                                data-testid="img-generated"
                              />
                              {/* Zoom icon overlay */}
                              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white bg-opacity-90 rounded-full p-3 transform scale-75 group-hover:scale-100 transition-transform">
                                  <i className="fas fa-search-plus text-gray-700 text-xl" aria-hidden="true"></i>
                                </div>
                              </div>
                              {/* NEW badge */}
                              <div className="absolute top-3 right-3 z-10">
                                <span className="bg-accent text-white text-xs px-2 py-1 rounded-full font-medium">NEW</span>
                              </div>
                            </div>
                          </DialogTrigger>
                          <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-transparent border-0 shadow-none">
                            <div className="relative flex items-center justify-center w-full h-full">
                              <img 
                                src={generation.generatedImageUrl} 
                                alt="AI generated result - Full size" 
                                className="max-w-full max-h-[95vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
                                data-testid="img-lightbox"
                              />
                              {/* Close button - positioned outside the image */}
                              <button
                                onClick={() => setIsLightboxOpen(false)}
                                className="absolute top-4 right-4 bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 hover:text-gray-900 rounded-full p-2 transition-all duration-200 shadow-lg z-10"
                                aria-label="Close lightbox"
                                data-testid="button-close-lightbox"
                              >
                                <i className="fas fa-times text-lg" aria-hidden="true"></i>
                              </button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </div>
                )}

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

          {/* Batch Results Section */}
          {batchData && batchData.generations.some(g => g.status === "completed" && g.generatedImageUrl) && (
            <Card className="bg-surface rounded-xl shadow-sm border border-gray-200" data-testid="batch-results-section">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-secondary flex items-center">
                    <i className="fas fa-images text-primary mr-2"></i>
                    Batch Generation Results
                  </h2>
                  <div className="flex items-center space-x-4">
                    <div className="text-sm text-gray-600" data-testid="batch-progress">
                      {batchData.completedCount} of {batchData.totalCount} complete
                    </div>
                    <div className="text-sm font-semibold text-primary" data-testid="batch-total-cost">
                      Total: ${batchData.totalCost.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                {batchData.completedCount < batchData.totalCount && (
                  <div className="mb-6">
                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                      <span>Processing Progress</span>
                      <span>{Math.round((batchData.completedCount / batchData.totalCount) * 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{width: `${(batchData.completedCount / batchData.totalCount) * 100}%`}}
                      ></div>
                    </div>
                  </div>
                )}

                {/* Original Image Reference */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="text-sm font-medium text-secondary mb-3 flex items-center">
                    <i className="fas fa-image text-gray-500 mr-2"></i>
                    Base Image Used for All Variations
                  </h3>
                  <div className="w-32 h-32 bg-gray-100 rounded-lg overflow-hidden">
                    <img 
                      src={uploadedImageUrl} 
                      alt="Base image for batch generation" 
                      className="w-full h-full object-cover" 
                      data-testid="img-batch-base"
                    />
                  </div>
                </div>

                {/* Generated Images Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {batchData.generations.map((gen, index) => (
                    <div key={gen.id} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium text-secondary">
                          Image {index + 1}
                        </h3>
                        <div className="flex items-center space-x-2">
                          {gen.status === "completed" && (
                            <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                              <i className="fas fa-check mr-1"></i>Complete
                            </span>
                          )}
                          {gen.status === "processing" && (
                            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                              <i className="fas fa-spinner fa-spin mr-1"></i>Processing
                            </span>
                          )}
                          {gen.status === "failed" && (
                            <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">
                              <i className="fas fa-exclamation mr-1"></i>Failed
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Image Display */}
                      <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                        {gen.status === "completed" && gen.generatedImageUrl ? (
                          <Dialog>
                            <DialogTrigger asChild>
                              <div 
                                className="relative cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-lg"
                                data-testid={`lightbox-trigger-${index}`}
                                role="button"
                                tabIndex={0}
                                aria-label={`Click to view full-size image ${index + 1}`}
                              >
                                <img 
                                  src={gen.generatedImageUrl} 
                                  alt={`AI generated variation ${index + 1}`} 
                                  className="w-full h-full object-cover transition-all duration-200" 
                                  data-testid={`img-batch-generated-${index}`}
                                />
                                {/* Zoom icon overlay */}
                                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white bg-opacity-90 rounded-full p-2 transform scale-75 group-hover:scale-100 transition-transform">
                                    <i className="fas fa-search-plus text-gray-700" aria-hidden="true"></i>
                                  </div>
                                </div>
                              </div>
                            </DialogTrigger>
                            <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-transparent border-0 shadow-none">
                              <div className="relative flex items-center justify-center w-full h-full">
                                <img 
                                  src={gen.generatedImageUrl} 
                                  alt={`AI generated variation ${index + 1} - Full size`} 
                                  className="max-w-full max-h-[95vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
                                  data-testid={`img-batch-lightbox-${index}`}
                                />
                              </div>
                            </DialogContent>
                          </Dialog>
                        ) : gen.status === "processing" ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="text-center space-y-2">
                              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
                              <p className="text-xs text-gray-500">Processing...</p>
                            </div>
                          </div>
                        ) : gen.status === "failed" ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="text-center space-y-2">
                              <i className="fas fa-exclamation-triangle text-red-400 text-2xl"></i>
                              <p className="text-xs text-red-600">Generation failed</p>
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="text-center space-y-2">
                              <i className="fas fa-clock text-gray-400 text-2xl"></i>
                              <p className="text-xs text-gray-500">Waiting...</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Prompt Display */}
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-600 font-medium mb-1">Prompt:</p>
                        <p className="text-sm text-gray-800" data-testid={`text-batch-prompt-${index}`}>
                          "{gen.prompt}"
                        </p>
                      </div>

                      {/* Individual Actions */}
                      {gen.status === "completed" && gen.generatedImageUrl && (
                        <div className="flex justify-center space-x-2">
                          <Button 
                            size="sm"
                            className="bg-primary hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-xs"
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = gen.generatedImageUrl!;
                              link.download = `ai-batch-${gen.id}-${index + 1}.jpg`;
                              link.click();
                            }}
                            data-testid={`button-download-${index}`}
                          >
                            <i className="fas fa-download mr-1"></i>
                            Download
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Batch Actions */}
                {batchData.completedCount > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <div className="flex flex-wrap gap-3 justify-center">
                      <Button 
                        className="bg-primary hover:bg-blue-800 text-white px-6 py-2 rounded-lg font-medium"
                        onClick={() => {
                          // Download all completed images as a zip would be ideal, but for now just download individually
                          const completedGens = batchData.generations.filter(g => g.status === "completed" && g.generatedImageUrl);
                          completedGens.forEach((gen, idx) => {
                            setTimeout(() => {
                              const link = document.createElement('a');
                              link.href = gen.generatedImageUrl!;
                              link.download = `ai-batch-${gen.id}-${idx + 1}.jpg`;
                              link.click();
                            }, idx * 100); // Stagger downloads slightly
                          });
                        }}
                        data-testid="button-download-all"
                      >
                        <i className="fas fa-download mr-2"></i>
                        Download All ({batchData.completedCount} images)
                      </Button>
                      <Button 
                        variant="secondary"
                        className="bg-gray-100 hover:bg-gray-200 text-secondary px-6 py-2 rounded-lg font-medium"
                        onClick={handleGenerate}
                        data-testid="button-generate-batch-again"
                      >
                        <i className="fas fa-redo mr-2"></i>
                        Generate Again
                      </Button>
                    </div>
                  </div>
                )}
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
