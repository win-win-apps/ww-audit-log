import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { boundary } from "@shopify/shopify-app-remix/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Billing plans. Names here are the keys billing.request / billing.check use.
// Keep these in sync with PLANS in app/utils/plan.ts and the App Store listing.
export const PRO_PLAN = "Pro" as const;
export const PREMIUM_PLAN = "Premium" as const;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [PRO_PLAN]: {
      lineItems: [
        {
          amount: 3.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PREMIUM_PLAN]: {
      lineItems: [
        {
          amount: 7.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
export { boundary, prisma };
