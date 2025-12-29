/**
 * Network Selector
 *
 * Shows current network indicator.
 * Currently restricted to devnet only (mainnet will be enabled after deployment).
 */

import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

// TODO: Add network switching when mainnet is enabled
export function NetworkSelector() {
  return (
    <Button variant="outline" size="sm" className="gap-2" disabled>
      <span className="h-2 w-2 rounded-full bg-blue-500" />
      <Globe className="h-4 w-4" />
      <span className="hidden sm:inline">Devnet</span>
    </Button>
  );
}
