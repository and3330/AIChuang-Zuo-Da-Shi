# AI Image Generator

## Overview

This is a full-stack web application that provides AI-powered image generation capabilities. The app allows users to upload original images, provide text prompts, and generate modified versions using AI image processing. Built with modern technologies, it features a React frontend with shadcn/ui components, an Express.js backend, and integrates with Google Cloud Storage for file management and object access control.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The client is built as a Single Page Application (SPA) using:
- **React 18** with TypeScript for type safety and modern development patterns
- **Vite** as the build tool and development server for fast compilation and hot module replacement
- **Wouter** for lightweight client-side routing
- **TanStack Query** for server state management, caching, and data synchronization
- **shadcn/ui** component library built on Radix UI primitives for accessible, customizable components
- **Tailwind CSS** with custom design tokens for consistent styling and responsive design
- **Uppy** file upload library with dashboard modal interface for handling file selection and upload progress

The frontend follows a component-based architecture with clear separation between UI components, business logic hooks, and API communication layers.

### Backend Architecture
The server uses a modern Node.js stack:
- **Express.js** framework with TypeScript for API endpoints and middleware
- **In-memory storage** using Map data structures for development/demo purposes
- **RESTful API design** with clear endpoint separation for different functionalities
- **Middleware pattern** for request logging, error handling, and response processing
- **Modular route organization** separating concerns between file upload, image generation, and object serving

### Data Storage Solutions
The application implements a hybrid storage approach:
- **In-memory storage** for application state (users, image generation records)
- **Google Cloud Storage** integration for file persistence and serving
- **Object-based file organization** with public/private access patterns
- **Drizzle ORM** configuration with PostgreSQL schema definitions for future database migration

The storage layer is designed with an interface pattern (`IStorage`) allowing easy swapping between in-memory and database implementations.

### Authentication and Authorization
Currently implements a basic structure with:
- User management schema with username/password fields
- Object Access Control Lists (ACLs) framework for fine-grained file permissions
- Group-based access control supporting various access patterns (user lists, email domains, group membership)
- Permission-based authorization (READ/WRITE permissions)

### File Upload and Management
Implements a comprehensive file handling system:
- **Direct-to-cloud uploads** using presigned URLs to reduce server load
- **Multi-stage upload process**: get upload URL → upload to cloud → set object path
- **Public and private object serving** with different access patterns
- **File type validation** and size limits through Uppy configuration
- **Progress tracking** and error handling for upload operations

## External Dependencies

### Cloud Services
- **Google Cloud Storage** - Primary file storage and CDN for images
- **Replit Sidecar** - Authentication service for Google Cloud integration
- **Neon Database** - PostgreSQL hosting (configured but not actively used)

### UI and Styling
- **shadcn/ui** - Complete component library with 30+ pre-built components
- **Radix UI** - Headless UI primitives for accessibility and behavior
- **Tailwind CSS** - Utility-first CSS framework with custom design system
- **Lucide Icons** - Icon library for consistent visual elements

### Development Tools
- **Vite** - Build tool with React plugin and runtime error overlay
- **TypeScript** - Static type checking across frontend and backend
- **Drizzle Kit** - Database migration and schema management tools
- **ESBuild** - Fast bundling for production builds

### File Processing
- **Uppy Core** - File upload orchestration and state management
- **Uppy Dashboard** - Rich upload interface with drag-and-drop support
- **Uppy AWS S3** - Direct-to-cloud upload integration

The architecture prioritizes scalability, type safety, and developer experience while maintaining clear separation of concerns between different system layers.