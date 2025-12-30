/**
 * Network Selector
 *
 * Dropdown to switch between devnet and mainnet.
 * Uses Wallet Standard chain identifiers (solana:devnet, solana:mainnet).
 * Changes are persisted to localStorage and trigger a page reload.
 */

import { Globe, Check, AlertTriangle } from "lucide-react";
import { useClusterStatus } from "@solana/react-hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getChain, setChain, getChainDisplayName, isMainnet, type SolanaChain } from "@/lib/network";

const CHAINS: { id: SolanaChain; label: string; color: string }[] = [
  { id: "solana:mainnet", label: "Mainnet", color: "bg-green-500" },
  { id: "solana:devnet", label: "Devnet", color: "bg-blue-500" },
];

export function NetworkSelector() {
  const clusterStatus = useClusterStatus();
  const currentChain = getChain();
  const current = CHAINS.find((c) => c.id === currentChain) ?? CHAINS[1];
  const onMainnet = isMainnet(currentChain);
  const hasError = clusterStatus.status === "error";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <span className={`h-2 w-2 rounded-full ${current.color}`} />
          {hasError ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-sm">
                  <strong>Connection error:</strong> Unable to connect to {getChainDisplayName(currentChain)}.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Try switching networks or check your connection.</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Globe className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{current.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {CHAINS.map((chain) => (
          <DropdownMenuItem
            key={chain.id}
            onClick={() => {
              if (chain.id !== currentChain) {
                setChain(chain.id);
              }
            }}
            className="gap-2"
          >
            <span className={`h-2 w-2 rounded-full ${chain.color}`} />
            <span>{chain.label}</span>
            {chain.id === currentChain && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}

        {/* Show mainnet warning */}
        {onMainnet && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mr-1 inline-block h-3 w-3" />
              <span>You are on Mainnet - real funds at risk</span>
            </div>
          </>
        )}

        {/* Show cluster status */}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium">Status:</span>{" "}
          {clusterStatus.status === "ready" ? (
            <span className="text-green-600 dark:text-green-400">Connected</span>
          ) : clusterStatus.status === "connecting" ? (
            <span className="text-amber-600 dark:text-amber-400">Connecting...</span>
          ) : clusterStatus.status === "error" ? (
            <span className="text-destructive">Error</span>
          ) : (
            <span>Idle</span>
          )}
          {"latencyMs" in clusterStatus && clusterStatus.latencyMs !== undefined && (
            <span className="ml-1">({clusterStatus.latencyMs}ms)</span>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
