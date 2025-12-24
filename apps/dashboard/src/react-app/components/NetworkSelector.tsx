/**
 * Network Selector
 *
 * Dropdown for switching between Solana networks (localnet, devnet, mainnet).
 * Uses the built-in @solana/client setCluster action for dynamic switching.
 */

import { useCallback } from "react";
import { Globe, Check, Loader2 } from "lucide-react";
import {
  useClusterState,
  useWalletActions,
  useClusterStatus,
} from "@solana/react-hooks";
import { resolveCluster, type ClusterMoniker } from "@solana/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resetSatiClient } from "@/lib/sati";
import { NETWORK_STORAGE_KEY } from "@/lib/constants";

type Network = "localnet" | "devnet" | "mainnet";

const NETWORKS: { value: Network; label: string; color: string }[] = [
  { value: "localnet", label: "Localnet", color: "bg-orange-500" },
  { value: "devnet", label: "Devnet", color: "bg-blue-500" },
  { value: "mainnet", label: "Mainnet", color: "bg-green-500" },
];

function getNetworkFromEndpoint(endpoint: string): Network {
  if (endpoint.includes("127.0.0.1") || endpoint.includes("localhost")) {
    return "localnet";
  }
  if (endpoint.includes("devnet")) {
    return "devnet";
  }
  return "mainnet";
}

export function NetworkSelector() {
  const clusterState = useClusterState();
  const clusterStatus = useClusterStatus();
  const actions = useWalletActions();

  const currentNetwork = getNetworkFromEndpoint(clusterState.endpoint);
  const currentConfig = NETWORKS.find((n) => n.value === currentNetwork);
  const isConnecting = clusterStatus.status === "connecting";

  const handleNetworkChange = useCallback(
    async (network: Network) => {
      if (network === currentNetwork) return;

      // Save to localStorage for persistence across reloads
      localStorage.setItem(NETWORK_STORAGE_KEY, network);

      // Get cluster config
      const cluster = resolveCluster({ moniker: network as ClusterMoniker });

      // Reset SATI client to pick up new network
      resetSatiClient();

      // Switch cluster using built-in action
      await actions.setCluster(cluster.endpoint, {
        websocketEndpoint: cluster.websocketEndpoint,
      });
    },
    [currentNetwork, actions],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={isConnecting}
        >
          {isConnecting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <span
                className={`h-2 w-2 rounded-full ${currentConfig?.color ?? "bg-gray-500"}`}
              />
              <Globe className="h-4 w-4" />
            </>
          )}
          <span className="hidden sm:inline">{currentConfig?.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Network</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {NETWORKS.map((network) => (
          <DropdownMenuItem
            key={network.value}
            onClick={() => handleNetworkChange(network.value)}
            className="cursor-pointer"
          >
            <span className={`mr-2 h-2 w-2 rounded-full ${network.color}`} />
            {network.label}
            {network.value === currentNetwork && (
              <Check className="ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
