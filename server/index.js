const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;


app.use(cors());
app.use(express.json());

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const uploadsDir = path.join(__dirname, "uploads");
const extractedDir = path.join(__dirname, "extracted");
const extractedAudioDir = path.join(extractedDir, "audio");
const extractedVideoDir = path.join(extractedDir, "video");

ensureDir(uploadsDir);
ensureDir(extractedAudioDir);
ensureDir(extractedVideoDir);

app.use("/files/audio", express.static(extractedAudioDir));
app.use("/files/video", express.static(extractedVideoDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const fileExt = path.extname(file.originalname) || ".mp4";
      const safeBaseName = path
        .parse(file.originalname)
        .name.replace(/[^a-zA-Z0-9-_]/g, "_");
      cb(null, `${safeBaseName}-${Date.now()}${fileExt}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) {
      cb(null, true);
      return;
    }

    cb(new Error("Only video files are allowed."));
  },
});

function removeIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function runFfmpegAudioExtraction(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("aac")
      .outputOptions(["-b:a 192k"])
      .on("start", (commandLine) => {
        console.log("Audio extraction command:", commandLine);
      })
      .on("error", reject)
      .on("end", resolve)
      .save(outputPath);
  });
}

function runFfmpegVideoOnlyExtraction(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noAudio()
      .videoCodec("libx264")
      .outputOptions(["-pix_fmt yuv420p"])
      .on("start", (commandLine) => {
        console.log("Video extraction command:", commandLine);
      })
      .on("error", reject)
      .on("end", resolve)
      .save(outputPath);
  });
}


app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "FFmpeg server is healthy",
    time: new Date()
  });
});


app.get("/", (req, res) => {
  res.send("FFmpeg Server Running. Open /upload to process videos.");
});

app.get("/upload", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Video Splitter</title>
  <style>
    body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #f6f9fc 0%, #e3edf7 100%);
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: #1f2937;
    }
    .card {
      width: min(560px, 92vw);
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
      padding: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 1.5rem;
    }
    p {
      margin-top: 0;
      color: #4b5563;
    }
    form {
      display: grid;
      gap: 12px;
    }
    input[type="file"] {
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 10px;
      background: #f9fafb;
    }
    button {
      border: 0;
      border-radius: 10px;
      padding: 10px 14px;
      background: #0f766e;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .status {
      min-height: 22px;
      margin-top: 10px;
      color: #374151;
      font-size: 0.95rem;
    }
    .result {
      margin-top: 12px;
      display: none;
      padding: 12px;
      border-radius: 10px;
      background: #f0fdf4;
      border: 1px solid #86efac;
    }
    .result a {
      color: #0f766e;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Upload Video And Split Tracks</h1>
    <p>Upload one video. Server will create audio-only (.m4a) and video-only (.mp4) files.</p>
    <form id="uploadForm">
      <input id="videoInput" name="video" type="file" accept="video/*" required />
      <button id="submitBtn" type="submit">Process Video</button>
    </form>
    <div id="status" class="status"></div>
    <section id="result" class="result">
      <div><a id="audioLink" href="#" target="_blank" rel="noopener noreferrer">Download Audio</a></div>
      <div><a id="videoLink" href="#" target="_blank" rel="noopener noreferrer">Download Video Only</a></div>
    </section>
  </main>

  <script>
    const form = document.getElementById("uploadForm");
    const videoInput = document.getElementById("videoInput");
    const statusEl = document.getElementById("status");
    const resultEl = document.getElementById("result");
    const audioLink = document.getElementById("audioLink");
    const videoLink = document.getElementById("videoLink");
    const submitBtn = document.getElementById("submitBtn");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      resultEl.style.display = "none";

      if (!videoInput.files || !videoInput.files[0]) {
        statusEl.textContent = "Please choose a video file first.";
        return;
      }

      submitBtn.disabled = true;
      statusEl.textContent = "Uploading and processing...";

      const formData = new FormData();
      formData.append("video", videoInput.files[0]);

      try {
        const response = await fetch("/extract-tracks", {
          method: "POST",
          body: formData,
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || "Failed to process video.");
        }

        audioLink.href = payload.audioUrl;
        videoLink.href = payload.videoUrl;
        resultEl.style.display = "block";
        statusEl.textContent = "Completed successfully.";
      } catch (error) {
        statusEl.textContent = error.message || "Unexpected error.";
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

app.post("/extract-tracks", (req, res) => {
  upload.single("video")(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError) {
        if (uploadError.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            status: "error",
            message: `Uploaded file is too large. Max allowed size is ${Math.floor(
              MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)
            )}MB.`,
          });
        }
      }

      return res.status(400).json({
        status: "error",
        message: uploadError.message || "Upload failed.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: "error",
        message: "Please upload a video file using field name 'video'.",
      });
    }

    const inputPath = req.file.path;
    const safeBaseName = path
      .parse(req.file.originalname)
      .name.replace(/[^a-zA-Z0-9-_]/g, "_");
    const timestamp = Date.now();
    const audioFileName = `${safeBaseName}-${timestamp}-audio.m4a`;
    const videoFileName = `${safeBaseName}-${timestamp}-video.mp4`;
    const audioOutputPath = path.join(extractedAudioDir, audioFileName);
    const videoOutputPath = path.join(extractedVideoDir, videoFileName);

    try {
      await runFfmpegAudioExtraction(inputPath, audioOutputPath);
      await runFfmpegVideoOnlyExtraction(inputPath, videoOutputPath);

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      return res.json({
        status: "ok",
        message: "Tracks extracted successfully.",
        inputFile: req.file.filename,
        audioFile: audioFileName,
        videoFile: videoFileName,
        audioUrl: `${baseUrl}/files/audio/${encodeURIComponent(audioFileName)}`,
        videoUrl: `${baseUrl}/files/video/${encodeURIComponent(videoFileName)}`,
      });
    } catch (error) {
      console.error("Track extraction failed:", error);
      removeIfExists(audioOutputPath);
      removeIfExists(videoOutputPath);

      return res.status(500).json({
        status: "error",
        message: `FFmpeg processing failed: ${error.message}`,
      });
    }
  });
});


/* ======================= */
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
