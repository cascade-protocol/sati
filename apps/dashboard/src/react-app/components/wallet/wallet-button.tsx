import { useWalletConnection } from "@solana/react-hooks";
import { Wallet, ChevronDown, LogOut, Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Solana wallet button using framework-kit's useWalletConnection hook.
 */
export function WalletButton() {
  const { connect, disconnect, connectors, connecting, connected, wallet } = useWalletConnection();
  const [copied, setCopied] = useState(false);

  const address = wallet?.account.address ?? "";
  const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : "";

  const copyAddress = useCallback(async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  // Not connected - show wallet selector dropdown
  if (!connected) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={connecting}>
            <Wallet className="h-4 w-4" />
            {connecting ? "Connecting..." : "Connect Wallet"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {connectors.map((connector) => (
            <DropdownMenuItem key={connector.id} onClick={() => connect(connector.id)}>
              {connector.icon && <img src={connector.icon} alt={connector.name} className="h-4 w-4" />}
              {connector.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Connected - show address with dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <span className="font-mono">{shortAddress}</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={copyAddress}>
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied!" : "Copy Address"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={disconnect} className="text-destructive">
          <LogOut className="h-4 w-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
