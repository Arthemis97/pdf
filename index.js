const express = require("express");
const puppeteer = require("puppeteer");
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");
const { exec } = require("child_process");
const fs = require("fs");
const sharp = require("sharp");
app.use(cors());
const storage = multer.memoryStorage();
const upload = multer({ storage });
const port = 4000;
app.use(bodyParser.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ limit: "100mb", extended: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
async function exportWebsiteAsPdf(html, outputPath) {
  const browser = await puppeteer.launch({
    headless: "new",
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.emulateMediaType("screen");
  const PDF = await page.pdf({
    margin: { top: "10mm", right: "15mm", bottom: "10mm", left: "15mm" },
    printBackground: true,
    format: "A4",
  });
  await browser.close();
  return PDF;
}
async function generateThumbnails(pass, callback) {
  const pdfPath = `./temp/PDF${pass.temp}.pdf`;
  const imagePathPrefix = `./temp/image${pass.temp}`;
  fs.writeFileSync(pdfPath, pass.buffer);

  const command = `pdftoppm -png ${pdfPath} ${imagePathPrefix}`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error("Error converting PDF to images:", error);
      return callback(error);
    }

    const imagePaths = [];
    const imageFiles = fs.readdirSync("./temp");
    for (const file of imageFiles) {
      if (file.startsWith(`image${pass.temp}`)) {
        imagePaths.push(`./temp/${file}`);
      }
    }
    callback(null, imagePaths);
  });
}

app.post("/order", async (req, res) => {
  const pdfDoc = await PDFDocument.create();
  const byteValues = req.body.buffer.split(",").map(Number);
  const uint8Array = new Uint8Array(byteValues);
  const existingPdf = await PDFDocument.load(uint8Array);
  const pages = await pdfDoc.copyPages(
    existingPdf,
    existingPdf.getPageIndices()
  );
  req.body.indexes.forEach((i, index) => {
    pdfDoc.addPage(pages[i]);
  });

  const pdfBytes = await pdfDoc.save({ addDefaultPage: false });
  const pdfBufferBase64 = pdfBytes.toString("base64");

  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    status: "ok",
    buffer: pdfBufferBase64,
  });
});

app.post("/generate", upload.array("files"), async (req, res) => {
  let html = `
	<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
	</head>
	<body>`;

  req.body.html.map((i) => {
    html += i + '<div class="pageBreak"></div>';
  });
  html += `
  <style>
			body {
				font-family: Arial, Helvetica, sans-serif;
				box-sizing: border-box; 
				page-break-inside: avoid;
			}
			figure {
				margin: 0 !important;
			}
			table, .table {
				border-collapse: collapse;
				width: 100% !important;
			}
			* {
				line-height: 5mm !important;
			}
			.pageBreak {
				page-break-after: always !important;
				clear: both !important;
			}
			tr {
				page-break-inside: avoid;
			}
		</style>
 	</body>
	</html> 
  `;

  exportWebsiteAsPdf(html, "result.PDF")
    .then(async (buffer) => {
      const pdfDoc = await PDFDocument.create();
      let buffers = [buffer];
      if (req.files && req.files.length > 0) {
        buffers = [...buffers, ...req.files.map((i) => i.buffer)];
      }
      for (const bf of buffers) {
        const existingPdf = await PDFDocument.load(bf);
        const pages = await pdfDoc.copyPages(
          existingPdf,
          existingPdf.getPageIndices()
        );
        pages.forEach((page) => pdfDoc.addPage(page));
      }

      const pdfBytes = await pdfDoc.save({ addDefaultPage: false });

      generateThumbnails(
        { buffer: pdfBytes, temp: req.body.temp },
        async (error, imagePaths) => {
          if (error) {
            console.error("Error converting PDF to images:", error);
            return;
          }

          try {
            const images = [];
            for (const imagePath of imagePaths) {
              const resizedImageBuffer = await sharp(imagePath)
                .resize(790, 1120)
                .toBuffer();
              const base64Image = resizedImageBuffer.toString("base64");
              images.push(base64Image);
              fs.unlinkSync(imagePath);
            }

            fs.unlinkSync(`./temp/PDF${req.body.temp}.pdf`);

            const pdfBufferBase64 = pdfBytes.toString("base64");

            res.setHeader("Content-Type", "application/json");
            res.status(200).json({
              status: "ok",
              buffer: pdfBufferBase64,
              thumbnails: images,
            });
          } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Error processing images" });
          }
        }
      );
    })
    .catch((error) => {
      console.error("Error creating PDF:", error);
    });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Example app listening on port ${port}`);
});
