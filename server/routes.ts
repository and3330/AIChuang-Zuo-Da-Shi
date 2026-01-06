import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertImageGenerationSchema, insertTextToImageSchema, insertImageToImageSchema, insertBatchImageToImageSchema, insertImageToVideoSchema } from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";

// SeedDance 4.5 API supported sizes (pass through directly)
function convertAspectRatioToSize(size: string): string {
  return size;
}

// New SeedDance 4.5 model endpoint
const SEEDDANCE_MODEL = "ep-20251223142939-njrkd";
const ARK_API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";

// Image-to-Video API endpoint and model
const VIDEO_MODEL = "ep-20250813120833-g4mpb";
const VIDEO_API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();

  // Serve public objects (for generated images)
  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Serve private objects (for uploaded images)
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error accessing object:", error);
      return res.status(404).json({ error: "File not found" });
    }
  });

  // Get upload URL for original images
  app.post("/api/objects/upload", async (req, res) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Set object path after upload
  app.put("/api/objects/set-path", async (req, res) => {
    if (!req.body.imageURL) {
      return res.status(400).json({ error: "imageURL is required" });
    }

    try {
      const objectPath = objectStorageService.normalizeObjectEntityPath(req.body.imageURL);
      res.status(200).json({ objectPath });
    } catch (error) {
      console.error("Error setting object path:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create new image generation request (single or batch)
  app.post("/api/image-generations", async (req, res) => {
    try {
      // Check if this is a batch request
      if (req.body.prompts && Array.isArray(req.body.prompts)) {
        // Batch generation request
        const validatedData = insertBatchImageToImageSchema.parse(req.body);
        const generations = await storage.createBatchImageGenerations(validatedData);
        
        // Start processing all generations in background  
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        generations.forEach(gen => {
          processImageGeneration(gen.id, baseUrl).catch(console.error);
        });
        
        res.json({ 
          batchId: generations[0].batchId,
          generations,
          totalCount: generations.length,
          totalCost: generations.length * 0.03
        });
      } else {
        // Single generation request (existing behavior)
        const requestType = req.body.type || "image-to-image";
        let validatedData;
        
        if (requestType === "text-to-image") {
          validatedData = insertTextToImageSchema.parse(req.body);
        } else {
          validatedData = insertImageToImageSchema.parse(req.body);
        }
        
        const generation = await storage.createImageGeneration(validatedData);
        
        // Start processing in background
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        processImageGeneration(generation.id, baseUrl).catch(console.error);
        
        res.json(generation);
      }
    } catch (error) {
      console.error("Error creating image generation:", error);
      res.status(500).json({ error: "Failed to create image generation" });
    }
  });

  // Get image generation by ID
  app.get("/api/image-generations/:id", async (req, res) => {
    try {
      const generation = await storage.getImageGeneration(req.params.id);
      if (!generation) {
        return res.status(404).json({ error: "Generation not found" });
      }
      res.json(generation);
    } catch (error) {
      console.error("Error getting image generation:", error);
      res.status(500).json({ error: "Failed to get image generation" });
    }
  });

  // Get batch generations by batch ID
  app.get("/api/batch-generations/:batchId", async (req, res) => {
    try {
      const generations = await storage.getImageGenerationsByBatchId(req.params.batchId);
      if (generations.length === 0) {
        return res.status(404).json({ error: "Batch not found" });
      }
      res.json({
        batchId: req.params.batchId,
        generations,
        totalCount: generations.length,
        completedCount: generations.filter(g => g.status === 'completed').length,
        failedCount: generations.filter(g => g.status === 'failed').length,
        totalCost: generations.reduce((sum, gen) => sum + (gen.cost || 0), 0)
      });
    } catch (error) {
      console.error("Error getting batch generations:", error);
      res.status(500).json({ error: "Failed to get batch generations" });
    }
  });

  // Get all image generations
  app.get("/api/image-generations", async (req, res) => {
    try {
      const generations = await storage.getAllImageGenerations();
      res.json(generations);
    } catch (error) {
      console.error("Error getting image generations:", error);
      res.status(500).json({ error: "Failed to get image generations" });
    }
  });

  // Get statistics
  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting stats:", error);
      res.status(500).json({ error: "Failed to get statistics" });
    }
  });

  async function processImageGeneration(generationId: string, baseUrl?: string) {
    try {
      await storage.updateImageGeneration(generationId, { status: "processing" });
      
      const generation = await storage.getImageGeneration(generationId);
      if (!generation) return;

      const startTime = Date.now();
      
      let requestBody: any;
      let apiKey: string | undefined;
      
      // Use the same ARK_API_KEY for both text-to-image and image-to-image (SeedDance 4.5)
      apiKey = process.env.ARK_API_KEY;
      
      if (generation.type === "text-to-image") {
        // Text-to-image generation with SeedDance 4.5
        const aspectRatio = generation.size || "1:1";
        const sizeValue = convertAspectRatioToSize(aspectRatio);
        
        // Check if sequential generation is enabled
        const isSequential = generation.sequentialGeneration && generation.maxImages && generation.maxImages > 1;
        
        requestBody = {
          model: SEEDDANCE_MODEL,
          prompt: generation.prompt,
          response_format: "url",
          size: sizeValue,
          sequential_image_generation: isSequential ? "auto" : "disabled",
          stream: isSequential,
          watermark: generation.watermark !== false
        };
        
        // Add max_images option for sequential generation
        if (isSequential) {
          requestBody.sequential_image_generation_options = {
            max_images: generation.maxImages
          };
        }
      } else {
        // Image-to-image generation
        if (!generation.originalImageUrl) {
          throw new Error("Original image URL is required for image-to-image generation");
        }
        
        // Helper function to convert image URL to base64 data URI
        const getImageAsDataUri = async (imageUrl: string): Promise<string> => {
          console.log(`Getting image from object storage: ${imageUrl}`);
          const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
          const chunks: Buffer[] = [];
          const stream = objectFile.createReadStream();
          
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          
          const imageBuffer = Buffer.concat(chunks);
          const base64Image = imageBuffer.toString('base64');
          return `data:image/jpeg;base64,${base64Image}`;
        };
        
        // Get primary image as base64
        const primaryDataUri = await getImageAsDataUri(generation.originalImageUrl);
        console.log(`✅ Primary image converted to base64`);
        
        // Check for multi-image input
        const hasMultipleImages = generation.additionalImageUrls && generation.additionalImageUrls.length > 0;
        
        let imageParam: string | string[];
        
        if (hasMultipleImages) {
          // Multi-image input: convert all additional images
          const additionalDataUris: string[] = [];
          for (const additionalUrl of generation.additionalImageUrls!) {
            const dataUri = await getImageAsDataUri(additionalUrl);
            additionalDataUris.push(dataUri);
            console.log(`✅ Additional image converted to base64`);
          }
          imageParam = [primaryDataUri, ...additionalDataUris];
          console.log(`Using multi-image input with ${imageParam.length} images`);
        } else {
          imageParam = primaryDataUri;
        }
        
        const aspectRatio = generation.size || "2K";
        const sizeValue = convertAspectRatioToSize(aspectRatio);
        
        // Check if sequential generation is enabled for image-to-image
        const isSequentialI2I = generation.sequentialGeneration && generation.maxImages && generation.maxImages > 1;
        
        requestBody = {
          model: SEEDDANCE_MODEL,
          prompt: generation.prompt,
          image: imageParam,
          response_format: "url",
          size: sizeValue,
          sequential_image_generation: isSequentialI2I ? "auto" : "disabled",
          stream: isSequentialI2I,
          watermark: generation.watermark !== false
        };
        
        // Add max_images option for sequential generation
        if (isSequentialI2I) {
          requestBody.sequential_image_generation_options = {
            max_images: generation.maxImages
          };
        }
      }

      console.log(`API Request Body:`, JSON.stringify(requestBody, null, 2));

      console.log(`Using ARK_API_KEY for ${generation.type}: ${apiKey ? 'SET' : 'NOT SET'}`);
      
      if (!apiKey) {
        throw new Error(`ARK_API_KEY environment variable is not set. Please configure your API key for SeedDance 4.5.`);
      }
      
      const response = await fetch(ARK_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log(`API response status: ${response.status}`);

      const processingTime = (Date.now() - startTime) / 1000;

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`❌ BytePlus API Error ${response.status}:`);
        console.log(errorText);
        await storage.updateImageGeneration(generationId, {
          status: "failed",
          errorMessage: `API Error: ${response.status} ${errorText}`,
          processingTime
        });
        return;
      }

      // Check if this is a streaming response (for sequential generation - both text-to-image and image-to-image)
      const isSequential = generation.sequentialGeneration && generation.maxImages && generation.maxImages > 1;
      
      if (isSequential) {
        // Handle streaming response for sequential generation
        const responseText = await response.text();
        const lines = responseText.split('\n').filter(line => line.trim());
        const generatedImageUrls: string[] = [];
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6); // Remove 'data: ' prefix
            if (jsonStr === '[DONE]') continue;
            
            try {
              const data = JSON.parse(jsonStr);
              if (data.data && Array.isArray(data.data)) {
                for (const item of data.data) {
                  if (item.url) {
                    generatedImageUrls.push(item.url);
                  }
                }
              }
            } catch (e) {
              console.log(`Failed to parse streaming line: ${jsonStr}`);
            }
          }
        }
        
        console.log(`Sequential generation completed with ${generatedImageUrls.length} images`);
        
        if (generatedImageUrls.length === 0) {
          await storage.updateImageGeneration(generationId, {
            status: "failed",
            errorMessage: "No generated images in streaming response",
            processingTime
          });
          return;
        }
        
        await storage.updateImageGeneration(generationId, {
          status: "completed",
          generatedImageUrl: generatedImageUrls[0],
          generatedImageUrls,
          processingTime,
          cost: 0.03 * generatedImageUrls.length
        });
      } else {
        // Handle normal non-streaming response
        const result = await response.json();
        const generatedImageUrl = result.data?.[0]?.url;

        if (!generatedImageUrl) {
          await storage.updateImageGeneration(generationId, {
            status: "failed",
            errorMessage: "No generated image URL in response",
            processingTime
          });
          return;
        }

        await storage.updateImageGeneration(generationId, {
          status: "completed",
          generatedImageUrl,
          processingTime,
          cost: 0.03
        });
      }

    } catch (error) {
      console.error("Error processing image generation:", error);
      await storage.updateImageGeneration(generationId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        processingTime: 0
      });
    }
  }

  // ===== VIDEO GENERATION ROUTES =====

  // Create video generation request
  app.post("/api/video-generations", async (req, res) => {
    try {
      const validatedData = insertImageToVideoSchema.parse(req.body);
      const generation = await storage.createVideoGeneration(validatedData);
      
      // Start processing in background
      processVideoGeneration(generation.id, objectStorageService).catch(console.error);
      
      res.json(generation);
    } catch (error) {
      console.error("Error creating video generation:", error);
      res.status(500).json({ error: "Failed to create video generation" });
    }
  });

  // Get video generation by ID
  app.get("/api/video-generations/:id", async (req, res) => {
    try {
      const generation = await storage.getVideoGeneration(req.params.id);
      if (!generation) {
        return res.status(404).json({ error: "Video generation not found" });
      }
      res.json(generation);
    } catch (error) {
      console.error("Error getting video generation:", error);
      res.status(500).json({ error: "Failed to get video generation" });
    }
  });

  // Get all video generations
  app.get("/api/video-generations", async (req, res) => {
    try {
      const generations = await storage.getAllVideoGenerations();
      res.json(generations);
    } catch (error) {
      console.error("Error getting video generations:", error);
      res.status(500).json({ error: "Failed to get video generations" });
    }
  });

  // Process video generation (async task-based API)
  async function processVideoGeneration(generationId: string, objectStorageService: ObjectStorageService) {
    try {
      await storage.updateVideoGeneration(generationId, { status: "processing" });
      
      const generation = await storage.getVideoGeneration(generationId);
      if (!generation) return;

      const startTime = Date.now();
      const apiKey = process.env.ARK_API_KEY;
      
      if (!apiKey) {
        throw new Error("ARK_API_KEY environment variable is not set");
      }

      // Get image as base64 data URI
      console.log(`Getting image from object storage: ${generation.originalImageUrl}`);
      const objectFile = await objectStorageService.getObjectEntityFile(generation.originalImageUrl);
      const chunks: Buffer[] = [];
      const stream = objectFile.createReadStream();
      
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      
      const imageBuffer = Buffer.concat(chunks);
      const base64Image = imageBuffer.toString('base64');
      const imageDataUri = `data:image/jpeg;base64,${base64Image}`;

      // Build prompt with duration and camera options
      let promptText = generation.prompt;
      promptText += ` --duration ${generation.duration}`;
      promptText += ` --camerafixed ${generation.cameraFixed}`;

      // Create video generation task
      const requestBody = {
        model: VIDEO_MODEL,
        content: [
          {
            type: "text",
            text: promptText
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUri
            }
          }
        ]
      };

      console.log(`Creating video generation task...`);
      console.log(`Prompt: ${promptText}`);

      const createResponse = await fetch(VIDEO_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.log(`❌ Video API Error ${createResponse.status}:`, errorText);
        throw new Error(`Video API error: ${createResponse.status} - ${errorText}`);
      }

      const createResult = await createResponse.json();
      const taskId = createResult.id;
      
      if (!taskId) {
        throw new Error("No task ID returned from video generation API");
      }

      console.log(`✅ Video task created with ID: ${taskId}`);
      await storage.updateVideoGeneration(generationId, { taskId });

      // Poll for task completion
      let attempts = 0;
      const maxAttempts = 120; // 10 minutes (5 second intervals)
      let videoUrl: string | null = null;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        attempts++;

        const pollResponse = await fetch(`${VIDEO_API_ENDPOINT}/${taskId}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          }
        });

        if (!pollResponse.ok) {
          console.log(`Poll attempt ${attempts} failed: ${pollResponse.status}`);
          continue;
        }

        const pollResult = await pollResponse.json();
        console.log(`Poll attempt ${attempts}: status = ${pollResult.status}`);

        if (pollResult.status === "succeeded") {
          // Log full response for debugging
          console.log("Video task succeeded, full response:", JSON.stringify(pollResult, null, 2));
          
          // Extract video URL from response - try multiple possible structures
          if (pollResult.content && Array.isArray(pollResult.content)) {
            for (const item of pollResult.content) {
              if (item.type === "video_url" && item.video_url?.url) {
                videoUrl = item.video_url.url;
                break;
              }
            }
          }
          
          // Alternative: check output field
          if (!videoUrl && pollResult.output?.video_url) {
            videoUrl = pollResult.output.video_url;
          }
          
          // Alternative: check result field
          if (!videoUrl && pollResult.result?.video_url) {
            videoUrl = pollResult.result.video_url;
          }
          
          // Alternative: check data field
          if (!videoUrl && pollResult.data?.video_url) {
            videoUrl = pollResult.data.video_url;
          }
          
          break;
        } else if (pollResult.status === "failed") {
          throw new Error(pollResult.error?.message || "Video generation failed");
        }
        // Continue polling if status is "running" or "pending"
      }

      const processingTime = (Date.now() - startTime) / 1000;

      if (!videoUrl) {
        throw new Error("Video generation timed out or no video URL returned");
      }

      console.log(`✅ Video generation completed: ${videoUrl}`);
      
      await storage.updateVideoGeneration(generationId, {
        status: "completed",
        generatedVideoUrl: videoUrl,
        processingTime,
        cost: 0.10 // Video generation cost estimate
      });

    } catch (error) {
      console.error("Error processing video generation:", error);
      await storage.updateVideoGeneration(generationId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        processingTime: 0
      });
    }
  }

  const httpServer = createServer(app);
  return httpServer;
}
