/**
 * Agent Avatar component
 *
 * Displays the SATI logo for all agents.
 */

import { cn } from "@/lib/utils";

interface AgentAvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-16 w-16",
};

export function AgentAvatar({
  name,
  size = "md",
  className,
}: AgentAvatarProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-primary/10 overflow-hidden shrink-0",
        sizeClasses[size],
        className,
      )}
    >
      <img
        src="/water-wave-cascade.svg"
        alt={name}
        className="h-full w-full object-cover p-1"
      />
    </div>
  );
}
