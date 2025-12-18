/**
 * Agent Avatar component
 *
 * Displays agent image from metadata URI, with fallback to Bot icon.
 */

import { Bot } from "lucide-react";
import { useAgentMetadata } from "@/hooks/use-sati";
import { getAgentImageUrl } from "@/lib/sati";
import { cn } from "@/lib/utils";

interface AgentAvatarProps {
  uri: string;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-16 w-16",
};

const iconSizes = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-8 w-8",
};

export function AgentAvatar({
  uri,
  name,
  size = "md",
  className,
}: AgentAvatarProps) {
  const { metadata, isLoading } = useAgentMetadata(uri);
  const imageUrl = getAgentImageUrl(metadata);

  const containerClass = cn(
    "flex items-center justify-center rounded-full bg-primary/10 overflow-hidden shrink-0",
    sizeClasses[size],
    className,
  );

  if (isLoading) {
    return (
      <div className={cn(containerClass, "animate-pulse bg-muted")} />
    );
  }

  if (imageUrl) {
    return (
      <div className={containerClass}>
        <img
          src={imageUrl}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <Bot className={cn("text-primary", iconSizes[size])} />
    </div>
  );
}
