import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { installMetaButtonEvents, sendMetaEvent, trackPendingGoogleRegistration } from "@/lib/metaPixel";
import { useUser } from "@/hooks/use-user";

export default function MetaEvents() {
  const [location] = useLocation();
  const { user } = useUser();
  const lastPath = useRef(location);
  useEffect(() => {
    if (user?.id) void trackPendingGoogleRegistration();
  }, [user?.id, location]);
  useEffect(() => installMetaButtonEvents(), []);
  useEffect(() => {
    if (lastPath.current === location) return;
    lastPath.current = location;
    // The HTML snippet already sends the first PageView. Only SPA navigation here.
    sendMetaEvent("PageView");
  }, [location]);
  return null;
}
