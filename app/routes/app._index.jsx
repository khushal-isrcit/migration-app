import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app/definition-sync");
};

export default function Index() {
  return null;
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
