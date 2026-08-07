import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

type ButtonVariant = "primary" | "secondary";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:opacity-90",
  secondary:
    "border border-border bg-card-solid text-muted-strong shadow-card hover:bg-card-raised hover:text-foreground",
};

const baseClasses =
  "inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-medium transition-all";

type ButtonProps = {
  variant?: ButtonVariant;
  className?: string;
} & (
  | ({ href: string } & Omit<ComponentPropsWithoutRef<"a">, "className">)
  | ({ href?: undefined } & ComponentPropsWithoutRef<"button">)
);

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
  const classes = cn(baseClasses, variantClasses[variant], className);

  if ("href" in props && props.href) {
    return <a className={classes} {...props} />;
  }

  const { href: _href, ...buttonProps } = props as ComponentPropsWithoutRef<"button"> & {
    href?: undefined;
  };
  return <button type="button" className={classes} {...buttonProps} />;
}
