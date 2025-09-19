import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertImageGenerationSchema, insertTextToImageSchema, insertImageToImageSchema } from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";

// Size conversion function to map aspect ratios to pixel dimensions
function convertAspectRatioToPixelDimensions(aspectRatio: string): string {
  const sizeMap: Record<string, string> = {
    "1:1": "1024x1024",
    "3:4": "768x1024", 
    "4:3": "1024x768",
    "16:9": "1920x1080",
    "9:16": "1080x1920",
    "2:3": "683x1024",
    "3:2": "1024x683",
    "21:9": "2560x1097"
  };
  
  return sizeMap[aspectRatio] || "1024x1024"; // Default to square if unknown
}

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

  // Create new image generation request
  app.post("/api/image-generations", async (req, res) => {
    try {
      // Validate request body based on type
      const requestType = req.body.type || "image-to-image";
      let validatedData;
      
      if (requestType === "text-to-image") {
        validatedData = insertTextToImageSchema.parse(req.body);
      } else {
        validatedData = insertImageToImageSchema.parse(req.body);
      }
      
      const generation = await storage.createImageGeneration(validatedData);
      
      // Start processing in background
      processImageGeneration(generation.id).catch(console.error);
      
      res.json(generation);
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

  async function processImageGeneration(generationId: string) {
    try {
      await storage.updateImageGeneration(generationId, { status: "processing" });
      
      const generation = await storage.getImageGeneration(generationId);
      if (!generation) return;

      const startTime = Date.now();
      
      let requestBody: any;
      let apiKey: string | undefined;
      
      if (generation.type === "text-to-image") {
        // Text-to-image generation
        const aspectRatio = generation.size || "1:1";
        const pixelSize = convertAspectRatioToPixelDimensions(aspectRatio);
        
        requestBody = {
          model: "ep-20250919143350-zlx7d",
          prompt: generation.prompt,
          response_format: "url",
          size: pixelSize,
          sequential_image_generation: "disabled",
          stream: false,
          watermark: generation.watermark
        };
        apiKey = process.env.ARK_TEXT_TO_IMAGE_API_KEY || "e21bc13e-482e-4f28-aa99-8be61cc6f547";
      } else {
        // Image-to-image generation
        if (!generation.originalImageUrl) {
          throw new Error("Original image URL is required for image-to-image generation");
        }
        
        // Get image as base64 (BytePlus cannot access Replit domains directly)
        const localImageUrl = `http://localhost:5000${generation.originalImageUrl}`;
        
        console.log(`Getting image from: ${localImageUrl}`);
        
        const imageResponse = await fetch(localImageUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch image: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const dataUri = `data:image/jpeg;base64,${base64Image}`;
        
        console.log(`✅ Image converted to base64 (${base64Image.length} chars)`);
        
        requestBody = {
          model: "ep-20250919143350-zlx7d",
          prompt: generation.prompt,
          image: dataUri,
          response_format: "url",
          sequential_image_generation: "disabled",
          stream: false,
          seed: generation.seed,
          watermark: generation.watermark
        };
        apiKey = process.env.ARK_API_KEY || "e21bc13e-482e-4f28-aa99-8be61cc6f547";
      }

      console.log(`API Request Body:`, JSON.stringify(requestBody, null, 2));

      console.log(`Using API key for ${generation.type}: ${apiKey ? 'SET' : 'NOT SET'}`);
      
      if (!apiKey) {
        throw new Error(`API key is not set for ${generation.type}`);
      }
      
      const response = await fetch("https://ark.ap-southeast.bytepluses.com/api/v3/images/generations", {
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
