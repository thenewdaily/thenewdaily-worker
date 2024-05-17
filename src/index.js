const MAX_ERROR_ATTEMPTS = 1;

const CACHE_TTL = 86400;
const QUERY_PARAMS = [
  "ahe",
  "acid",
  "utm_campaign",
  "utm_medium",
  "utm_source",
  "lr_hash",
];

export default {
  async fetch(request, env, ctx) {
    if (request.body) {
      // This request has a body, i.e. it's submitting some information to
      // the server, not just requesting a web page. If we wanted to be able
      // to retry such requests, we'd have to buffer the body so that we
      // can send it twice. That is expensive, so instead we'll just hope
      // that these requests (which are relatively uncommon) don't fail.
      // So we just pass the request to the server and return the response
      // nomally.
      return fetch(request);
    }

    let response;

    // EDM Rewrite Cache

    const url = new URL(request.url);

    // Keep an original copy of the URL
    const masterUrl = new URL(request.url);

    // Check if the first parameter in QUERY_PARAMS exists in the master URL

    const queryParamsArray = Array.from(masterUrl.searchParams.keys());
    const isEDM = QUERY_PARAMS.every((param) =>
      queryParamsArray.includes(param)
    );

    if (isEDM) {
      // Clear all query parameters from the URL
      url.search = "";

      // Redirect to the same URL without the trailing slash
      if (url.pathname.endsWith("/") && url.pathname !== "/") {
        url.pathname = url.pathname.slice(0, -1);
        // Redirect
        return Response.redirect(url.toString() + masterUrl.search, 301);
      }

      // Return a static response
      const cacheKey = new Request(url, { cf: { cacheTtl: CACHE_TTL } });

      // Try the request the first time.
      response = await fetch(cacheKey);
    } else {
      response = await fetch(request);
    }

    // 500 or 522 status error check

    let currentErrorAttempt = 0;

    while (
      (response.status == 500 || response.status == 522) &&
      currentErrorAttempt < MAX_ERROR_ATTEMPTS
    ) {
      console.log("🛑 error hit", response.status);

      const responseBody = await response.clone().text();
      console.log("error body:", String(responseBody).substring(0, 100));

      // The server returned status 500. Let's retry the request. But
      // we'll only retry once, since we don't want to get stuck in an
      // infinite retry loop.

      // Let's discard the previous response body. This is not strictly
      // required but it helps let the Workers Runtime know that it doesn't
      // need to hold open the HTTP connection for the failed request.
      // await response.arrayBuffer();

      // Add a 10 second delay for debugging
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const refetchUrl = new URL(request.url);
      refetchUrl.searchParams.append("c", "1");

      console.log("error ℹ️ url", refetchUrl);

      const newRequestWithQuery = new Request(refetchUrl);

      const purgePathUrl = `https://thenewdaily.com.au/api/purgeCloudflareCache?paths=${request.url}`;

      const purgeResponse = await fetch(purgePathUrl, { cache: "no-cache" });

      const purgeResponseBody = await purgeResponse.clone().text();

      console.log("error ℹ️ purge", purgeResponseBody);

      // OK, now we retry the request, and replace the response with the
      // new version.
      response = await fetch(newRequestWithQuery);

      const responseBodyRefetch = await response.clone().text();

      console.log(
        "error refetch ",
        String(responseBodyRefetch.substring(0, 100))
      );

      currentErrorAttempt++;
    }

    return response;
  },
};
