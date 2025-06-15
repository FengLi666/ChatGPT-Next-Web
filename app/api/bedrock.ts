import { getServerSideConfig } from "@/app/config/server";
import {
  BEDROCK_BASE_URL,
  ApiPath,
  ModelProvider,
  ServiceProvider,
} from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { isModelNotavailableInServer } from "@/app/utils/model";
import aws4 from "aws4";

const serverConfig = getServerSideConfig();

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[Bedrock Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const authResult = auth(req, ModelProvider.Claude);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    const response = await request(req);
    return response;
  } catch (e) {
    console.error("[Bedrock] ", e);
    return NextResponse.json(prettyObject(e));
  }
}

async function request(req: NextRequest) {
  const controller = new AbortController();

  let path = `${req.nextUrl.pathname}`.replaceAll(ApiPath.Bedrock, "");

  let baseUrl = serverConfig.bedrockUrl || BEDROCK_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy] ", path);
  console.log("[Base Url]", baseUrl);

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  const fetchUrl = `${baseUrl}${path}`;

  const unsignedOptions: aws4.Request = {
    host: fetchUrl.split("//")[1],
    path: `/${path}`,
    service: "bedrock",
    region: serverConfig.bedrockRegion,
    method: req.method,
    body: req.body ? await req.text() : undefined,
    headers: {
      "Content-Type": "application/json",
    },
  } as any;

  aws4.sign(unsignedOptions, {
    accessKeyId: serverConfig.bedrockAccessKeyId || "",
    secretAccessKey: serverConfig.bedrockSecretAccessKey || "",
    sessionToken: serverConfig.bedrockSessionToken || undefined,
  });

  const fetchOptions: RequestInit = {
    method: unsignedOptions.method,
    body: unsignedOptions.body,
    headers: unsignedOptions.headers as any,
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  if (serverConfig.customModels && fetchOptions.body) {
    try {
      const jsonBody = JSON.parse(fetchOptions.body as string) as {
        model?: string;
      };

      if (
        isModelNotavailableInServer(
          serverConfig.customModels,
          jsonBody?.model as string,
          ServiceProvider.Bedrock as string,
        )
      ) {
        return NextResponse.json(
          {
            error: true,
            message: `you are not allowed to use ${jsonBody?.model} model`,
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {
      console.error(`[Bedrock] filter`, e);
    }
  }
  try {
    const res = await fetch(fetchUrl, fetchOptions);

    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    newHeaders.set("X-Accel-Buffering", "no");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
