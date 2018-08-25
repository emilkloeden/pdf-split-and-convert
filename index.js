require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const uuidv4 = require("uuid/v4");
const Service = require("naive-service-register");

const eyes = require("eyes");
const inspect = eyes.inspector({ maxLength: 20000 });
const PDFExtract = require("pdf-extract");
const PDFImage = require("pdf-image").PDFImage;

const fs = require("fs");
const path = require("path");
const makeDir = require("make-dir");

const app = express();

app.use(bodyParser.json());
app.use(morgan("common"));

const SERVICE_NAME = process.env.SERVICE_NAME || "PDF Split and Convert";
const HOSTNAME = process.env.HOSTNAME || "localhost";
const PORT = process.env.PORT || 5000;
const registryHostname = process.env.SERVICE_REGISTRY_HOSTNAME;
const registryPort = process.env.SERVICE_REGISTRY_PORT;
const serviceInstanceID = uuidv4();

// functions

function makeDirIfNotExistsSync(path) {
  const directoryExists = fs.existsSync(path);
  return directoryExists ? path : makeDir.sync(path);
}

async function createPNGs(PDFPath, PNGPath, cb) {
  makeDirIfNotExistsSync(PNGPath);

  convertOptions = {
    "-alpha": "Off"
  };
  const pdfImage = new PDFImage(PDFPath, convertOptions);
  pdfImage.outputDirectory = PNGPath;

  pdfImage
    .convertFile()
    .then(cb(null, PNGPath))
    .catch(e => cb(e));
}

async function extractText(PDFPath, TXTPath, cb) {
  makeDirIfNotExistsSync(TXTPath);

  const options = { type: "ocr" };

  const processor = PDFExtract(PDFPath, options, err => {
    if (err) {
      return cb(err);
    }
  });
  processor.on("page", data => {
    const { index, text } = data;
    const filePath = path.resolve(TXTPath, `${index + 1}.txt`);

    fs.writeFile(filePath, text, () => {});
  });
  processor.on("complete", data => {
    cb(null, TXTPath);
  });
  processor.on("error", err => {
    return cb(err);
  });
}

// routes
// Obligatory ping
app.get("/ping", (req, res) => res.sendStatus(200));

// request PDF file parsed
app.post("/", async (req, res) => {
  const { PDFPath, slug } = req.body;
  const baseDir = path.dirname(PDFPath);
  const PNGPath = path.resolve(baseDir, slug, "png");
  const TXTPath = path.resolve(baseDir, slug, "txt");
  /* Here we respond early and optimistically
  * The process took over 5 minutes for 69 pages (super slow) and the API client (Insomnia) times out at 2 minutes
  */
  res.sendStatus(200);
  const start = new Date();
  inspect(`Started processing at ${start}`);
  createPNGs(PDFPath, PNGPath, err => {
    if (err) {
      inspect(`Error in createPNGs ${err.name}: ${err.message}`);
    } else {
      extractText(PDFPath, TXTPath, err => {
        if (err) {
          inspect(`Error in extractText ${err.name}: ${err.message}`);
        } else {
          const end = new Date();
          inspect(
            `All good: finished ${end}. Duration: ${(end - start) /
              1000} seconds.`
          );
        }
      });
    }
  });
});

const options = {
  service: SERVICE_NAME,
  registryHostname,
  registryPort,
  hostname: HOSTNAME,
  port: PORT
};

const service = new Service(SERVICE_NAME, options);

service.register(err => {
  if (err) {
    console.error(
      `Unable to register ${SERVICE_NAME} instance: ${serviceInstanceID}, shutting down.\nError:${err}`
    );
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(
      `${SERVICE_NAME} instance: ${serviceInstanceID} running on host: ${HOSTNAME} and port: ${PORT}`
    );
  });
});
