import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertImageGenerationSchema, insertTextToImageSchema, insertImageToImageSchema, insertBatchImageToImageSchema } from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";

// Size conversion function to map aspect ratios to SeedDance 4.5 format
function convertAspectRatioToSize(aspectRatio: string): string {
  const sizeMap: Record<string, string> = {
    "1:1": "1024x1024",
    "3:4": "768x1024", 
    "4:3": "1024x768",
    "16:9": "1920x1080",
    "9:16": "1080x1920",
    "2:3": "683x1024",
    "3:2": "1024x683",
    "21:9": "2560x1097",
    "A4": "2480x3508",
    "A5": "1748x2480",
    "2K": "2K",
    "4K": "4K"
  };
  
  return sizeMap[aspectRatio] || "1024x1024";
}

// New SeedDance 4.5 model endpoint
const SEEDDANCE_MODEL = "ep-20251223142939-njrkd";
const ARK_API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";

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
        
        requestBody = {
          model: SEEDDANCE_MODEL,
          prompt: generation.prompt,
          response_format: "url",
          size: sizeValue,
          sequential_image_generation: "auto",
          stream: false,
          watermark: generation.watermark !== false
        };
      } else {
        // Image-to-image generation
        if (!generation.originalImageUrl) {
          throw new Error("Original image URL is required for image-to-image generation");
        }
        
        // Get image data directly from object storage instead of HTTP fetch
        console.log(`Getting image from object storage: ${generation.originalImageUrl}`);
        
        const objectFile = await objectStorageService.getObjectEntityFile(generation.originalImageUrl);
        
        // Read the file data as buffer
        const chunks: Buffer[] = [];
        const stream = objectFile.createReadStream();
        
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        
        const imageBuffer = Buffer.concat(chunks);
        const base64Image = imageBuffer.toString('base64');
        const dataUri = `data:image/jpeg;base64,${base64Image}`;
        
        console.log(`✅ Image converted to base64 (${base64Image.length} chars)`);
        
        requestBody = {
          model: SEEDDANCE_MODEL,
          prompt: generation.prompt,
          image: dataUri,
          response_format: "url",
          sequential_image_generation: "auto",
          stream: false,
          seed: generation.seed,
          watermark: generation.watermark !== false
        };
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

    } catch (error) {
      console.error("Error processing image generation:", error);
      await storage.updateImageGeneration(generationId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        processingTime: 0
      });
    }
  }

  const httpServer = createServer(app);
  return httpServer;
}
