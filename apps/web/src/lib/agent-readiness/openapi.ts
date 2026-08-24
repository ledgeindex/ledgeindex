import { getSiteUrl } from "@/lib/site-url";
import { getPublicApiBaseUrl } from "./api-base";
import {
  buildPublicMcpManifest,
  buildPublicOpenApiSpec,
} from "../../../../../packages/docs/src/runtime/openapi/public-api-spec";

export function buildOpenApiSpec() {
  return buildPublicOpenApiSpec({
    siteUrl: getSiteUrl(),
    apiUrl: getPublicApiBaseUrl(),
  });
}

export function buildMcpManifest() {
  return buildPublicMcpManifest({
    siteUrl: getSiteUrl(),
    apiUrl: getPublicApiBaseUrl(),
  });
}
