import { useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router";
import { Menu, Bot } from "lucide-react";
import { WalletButton } from "./wallet/wallet-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

const getNavLinkClasses = (isActive: boolean) =>
  `rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive
      ? "bg-accent font-medium text-accent-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;

const getMobileNavLinkClasses = (isActive: boolean) =>
  `block rounded-md px-3 py-2 text-base transition-colors ${
    isActive
      ? "bg-accent font-medium text-accent-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`;

/**
 * Header with logo, navigation, social links, and wallet connection.
 */
export function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close sheet on navigation
  useEffect(() => {
    if (location.pathname) setOpen(false);
  }, [location.pathname]);

  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 md:px-6 md:py-6">
        <div className="flex items-center justify-between">
          {/* Left group: Logo + Title + Nav */}
          <div className="flex items-center gap-4 md:gap-6">
            <Link to="/" className="flex items-center gap-2 md:gap-3">
              <Bot className="h-8 w-8 md:h-10 md:w-10 text-primary" />
              <h1 className="hidden text-lg font-semibold sm:block md:text-xl">
                SATI
              </h1>
            </Link>

            {/* Desktop Navigation - hidden on mobile */}
            <nav className="hidden items-center gap-1 md:flex">
              <NavLink
                to="/"
                end
                className={({ isActive }) => getNavLinkClasses(isActive)}
              >
                My Agents
              </NavLink>
              <NavLink
                to="/explore"
                className={({ isActive }) => getNavLinkClasses(isActive)}
              >
                Explore
              </NavLink>
            </nav>
          </div>

          {/* Right group: Social icons + Wallet + Mobile menu */}
          <div className="flex items-center gap-3 md:gap-4">
            {/* Desktop social icons - hidden on mobile */}
            <a
              href="https://github.com/cascade-protocol/sati"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden text-muted-foreground transition-colors hover:text-foreground md:block"
            >
              <svg
                role="img"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 fill-current"
              >
                <title>GitHub</title>
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              <span className="sr-only">GitHub</span>
            </a>

            {/* Wallet button - always visible */}
            <WalletButton />

            {/* Mobile menu button */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 md:hidden"
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>Menu</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col gap-4 px-4">
                  <nav className="flex flex-col gap-1">
                    <NavLink
                      to="/"
                      end
                      className={({ isActive }) =>
                        getMobileNavLinkClasses(isActive)
                      }
                    >
                      My Agents
                    </NavLink>
                    <NavLink
                      to="/explore"
                      className={({ isActive }) =>
                        getMobileNavLinkClasses(isActive)
                      }
                    >
                      Explore
                    </NavLink>
                  </nav>
                  <Separator />
                  <div className="flex items-center gap-4">
                    <a
                      href="https://github.com/cascade-protocol/sati"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <svg
                        role="img"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5 fill-current"
                      >
                        <title>GitHub</title>
                        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                      </svg>
                      <span className="sr-only">GitHub</span>
                    </a>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
