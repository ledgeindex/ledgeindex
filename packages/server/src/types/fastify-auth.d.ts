import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      uid: string;
      email: string | null;
      authMethod: "firebase" | "api_key";
      scopes: string[];
    };
  }
}
