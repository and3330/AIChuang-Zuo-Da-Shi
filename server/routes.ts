import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertImageGenerationSchema } from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";

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
      const validatedData = insertImageGenerationSchema.parse(req.body);
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

  async function processImageGeneration(generationId: string) {
    try {
      await storage.updateImageGeneration(generationId, { status: "processing" });
      
      const generation = await storage.getImageGeneration(generationId);
      if (!generation) return;

      const startTime = Date.now();
      
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
      
      const requestBody = {
        model: "ep-20250824201751-nm8dh",
        prompt: generation.prompt,
        image: dataUri,
        response_format: "url",
        size: "1024x1024",
        seed: generation.seed,
        guidance_scale: generation.guidanceScale,
        watermark: generation.watermark
      };

      console.log(`API Request Body:`, JSON.stringify(requestBody, null, 2));

      // Call BytePlus API
      const response = await fetch("https://ark.ap-southeast.bytepluses.com/api/v3/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer d3ad50dc-9caf-4bf8-aef3-e2e1b850c0ed`
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
        processingTime
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
