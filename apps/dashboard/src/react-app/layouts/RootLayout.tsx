import { Outlet } from "react-router";
import { Header } from "@/components/Header";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getChain, getChainDisplayName } from "@/lib/network";

export function RootLayout() {
  const currentChain = getChain();

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <Header />

        <ErrorBoundary>
          <div className="flex flex-1 flex-col min-h-0 overflow-auto">
            <Outlet />
          </div>
        </ErrorBoundary>

        {/* Footer */}
        <footer className="shrink-0 border-t py-4 px-4 md:px-6">
          <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>SATI Registry</span>
              <span className="text-xs">&copy; 2025</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-muted px-2 py-0.5 rounded">Solana {getChainDisplayName(currentChain)}</span>
            </div>
          </div>
        </footer>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}
