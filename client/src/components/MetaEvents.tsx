import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { installMetaButtonEvents, sendMetaEvent } from "@/lib/metaPixel";

export default function MetaEvents() {
  const [location] = useLocation();
  const lastPath = useRef(location);
  useEffect(() => installMetaButtonEvents(), []);
  useEffect(() => {
    if (lastPath.current === location) return;
    lastPath.current = location;
    // The HTML snippet already sends the first PageView. Only SPA navigation here.
    sendMetaEvent("PageView");
  }, [location]);
  return null;
}
