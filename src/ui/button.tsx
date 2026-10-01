import Link from "next/link";
import type { ComponentProps } from "react";
import { Button as BaseButton, buttonVariants } from "@/components/ui/button";
import { cn } from "./cn";

// Demo-era API kept as a thin wrapper over the generated shadcn Button (F3 deletes it).
type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantMap = {
  primary: "default",
  secondary: "secondary",
  outline: "outline",
  ghost: "ghost",
  danger: "destructive",
} as const;
const sizeMap = { sm: "sm", md: "default", lg: "lg" } as const;

export function buttonClasses(variant: Variant = "primary", size: Size = "md"): string {
  return buttonVariants({ variant: variantMap[variant], size: sizeMap[size] });
}

type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size };

export function Button({ variant = "primary", size = "md", ...props }: ButtonProps) {
  return <BaseButton variant={variantMap[variant]} size={sizeMap[size]} {...props} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size };

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={cn(buttonClasses(variant, size), className)} {...props} />;
}
