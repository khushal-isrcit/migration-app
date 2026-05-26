import { Outlet, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}

export default function DefinitionSyncLayout() {
  return <Outlet />;
}
