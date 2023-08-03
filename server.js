import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();

const PORT = process.env.PORT || 3000;

// List of allowed origins
const whitelist = ["example.com"];

// middleware to check origin
const corsOptions = {
  origin: function (origin, callback) {
    console.log(origin);
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
};

// https://stackoverflow.com/questions/1714786/query-string-encoding-of-a-javascript-object
const serialize = (obj) => {
  const str = [];
  for (const p in obj)
    if (obj.hasOwnProperty(p)) {
      str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
    }
  return str.join("&");
};

// [['cookie', 'x-foo']] -> [["cookie", "x-foo"]]
const parseHeaders = (stringHeaders) => {
  try {
    return JSON.parse(stringHeaders);
  } catch {
    try {
      return JSON.parse(stringHeaders.replace(/'/g, '"'));
    } catch {
      return {};
    }
  }
};

// [["cookie", "x-foo"]] -> { cookie: "x-foo" }
const composeHeaders = (arrayOfHeaders) => {
  const headers = {};

  arrayOfHeaders.forEach((header) => {
    headers[header[0]] = header[1];
  });

  return headers;
};

// Parse string to its type
const composeQuery = (originalQuery) => {
  let query = originalQuery;

  if (originalQuery?.decompress) {
    query.ignoreReqHeaders = originalQuery?.decompress === "true";
  }

  if (originalQuery?.ignoreReqHeaders) {
    query.ignoreReqHeaders = originalQuery?.ignoreReqHeaders === "true";
  }

  if (originalQuery?.redirectWithProxy) {
    query.ignoreReqHeaders = originalQuery?.redirectWithProxy === "true";
  }

  if (originalQuery?.followRedirect) {
    query.followRedirect = originalQuery?.followRedirect === "true";
  }

  if (originalQuery?.appendReqHeaders) {
    const headers = parseHeaders(originalQuery.appendReqHeaders);

    query.appendReqHeaders = composeHeaders(headers);
  }

  if (originalQuery?.appendResHeaders) {
    const headers = parseHeaders(originalQuery.appendResHeaders);

    query.appendResHeaders = composeHeaders(headers);
  }

  if (originalQuery?.deleteReqHeaders) {
    const headers = parseHeaders(originalQuery.deleteReqHeaders);

    query.deleteReqHeaders = headers;
  }

  if (originalQuery?.deleteResHeaders) {
    const headers = parseHeaders(originalQuery.deleteResHeaders);

    query.deleteResHeaders = headers;
  }

  return query;
};

// https://bobbyhadz.com/blog/javascript-lowercase-object-keys
const toLowerKeys = (obj) =>
  Object.keys(obj).reduce((accumulator, key) => {
    accumulator[key.toLowerCase()] = obj[key];
    return accumulator;
  }, {});

const concatHeaders = (...args) => {
  const totalHeaders = {};

  for (const headers of args) {
    Object.assign(totalHeaders, toLowerKeys(headers));
  }

  return totalHeaders;
};

// Error handling middleware
app.use((req, res, next) => {
  if (!req.get('Access-Control-Allow-Origin')) {
    res.status(418).send(`
    <html>
      <head>
        <title>Leave us alone!</title>
      </head>
      
      <h1 style="color:#11111">Unauthorized origin.</h1><br>
      <h2>You shall not pass!</h2>
      <img src="https://media.tenor.com/VOdWjm2zbEAAAAAC/gandalf-sax-guy.gif" width="50%" />
    </html>
    
    `);
  } else {
    next();
  }
});


app.get("/proxy", cors(corsOptions), async (req, res) => {
  const query = composeQuery(req.query);

  const {
    url,
    ignoreReqHeaders = false,
    followRedirect = false,
    redirectWithProxy = false,
    decompress = false,
    appendReqHeaders = {},
    appendResHeaders = {},
    deleteReqHeaders = [],
    deleteResHeaders = [],
  } = query;

  if (!url) {
    res.status(400).send("Missing url");
    return;
  }

  const decodedUrl = decodeURIComponent(url);

  const host = new URL(decodedUrl).host;

  let headers = concatHeaders({ host, ...appendReqHeaders });

  if (!ignoreReqHeaders) {
    headers = concatHeaders(req.headers, headers);
  }

  const filteredHeaders = Object.keys(headers).reduce((acc, key) => {
    if (!deleteReqHeaders.includes(key)) {
      acc[key] = headers[key];
    }
    return acc;
  }, {});

  const response = await axios.get(decodedUrl, {
    responseType: "stream",
    headers: filteredHeaders,
    validateStatus: () => true,
    maxRedirects: !followRedirect ? 0 : 5,
    decompress,
  });

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
  };

  const resHeaders = concatHeaders(
    response.headers,
    corsHeaders,
    appendResHeaders
  );

  for (let header in resHeaders) {
    if (deleteResHeaders.includes(header.toLowerCase())) continue;

    if (header.toLowerCase() === "location") {
      const originalUrl = resHeaders[header];
      const encodedUrl = encodeURIComponent(originalUrl);
      const redirectUrl = redirectWithProxy
        ? `/proxy?url=${encodedUrl}&${serialize(query)}`
        : originalUrl;

      res.redirect(response.status, redirectUrl);

      return;
    }

    res.setHeader(header, resHeaders[header]);
  }

  res.status(response.status);

  response.data.pipe(res);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
