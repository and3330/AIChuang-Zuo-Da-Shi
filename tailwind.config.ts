import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        // Palette for the whole site (tech look):
        //   brand   violet -> indigo -> blue gradient (bg-brand, see index.css)
        //   sky     light-blue secondary          fuchsia  pop accent
        //   indigo  solid brand / primary actions slate    neutrals
        //   amber   credits and warnings         emerald success
        //   red     errors and destructive       rose    adult-only areas
        // Older pages were written with purple-* / blue-* / gray-* classes;
        // aliasing those names makes every page render the same brand colour
        // and neutral without touching each file. Use sky-* where a second
        // accent is really needed.
        purple: colors.indigo,
        blue: colors.indigo,
        violet: colors.indigo,
        gray: colors.slate,
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "#4f46e5", // indigo-600, the brand colour
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "#424242", // hsl(220 9% 26%)
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "#f1f5f9", // slate-100: hover / focus background of menus
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        surface: "#FFFFFF",
      },
      backgroundImage: {
        brand: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 48%, #2563eb 100%)",
        "brand-soft": "linear-gradient(135deg, #f5f3ff 0%, #eef2ff 50%, #e0f2fe 100%)",
        "brand-night": "linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #1e3a8a 100%)",
      },
      boxShadow: {
        glow: "0 10px 28px -10px rgba(99, 70, 229, 0.55)",
        "glow-sky": "0 10px 28px -10px rgba(14, 165, 233, 0.5)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
        inter: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-33.33%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        marquee: "marquee 15s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
