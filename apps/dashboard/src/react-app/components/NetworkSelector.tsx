/**
 * Network Selector
 *
 * Dropdown to switch between devnet and mainnet.
 * Changes are persisted to localStorage and trigger a page reload.
 */

import { Globe, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNetwork, setNetwork, type Network } from "@/lib/network";

const NETWORKS: { id: Network; label: string; color: string }[] = [
  { id: "mainnet", label: "Mainnet", color: "bg-green-500" },
  { id: "devnet", label: "Devnet", color: "bg-blue-500" },
];

export function NetworkSelector() {
  const currentNetwork = getNetwork();
  const current = NETWORKS.find((n) => n.id === currentNetwork) ?? NETWORKS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <span className={`h-2 w-2 rounded-full ${current.color}`} />
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline">{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {NETWORKS.map((network) => (
          <DropdownMenuItem
            key={network.id}
            onClick={() => {
              if (network.id !== currentNetwork) {
                setNetwork(network.id);
              }
            }}
            className="gap-2"
          >
            <span className={`h-2 w-2 rounded-full ${network.color}`} />
            <span>{network.label}</span>
            {network.id === currentNetwork && (
              <Check className="ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
