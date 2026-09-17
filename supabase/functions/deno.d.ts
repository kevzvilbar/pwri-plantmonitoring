// Ambient type definitions for Supabase Edge Functions in VS Code / TypeScript

declare module 'https://*';
declare module 'https://deno.land/*';
declare module 'https://esm.sh/*';

declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): Record<string, string>;
  };
  [key: string]: any;
};
