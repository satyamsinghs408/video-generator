const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");

const app = express();


app.use(cors());
app.use(express.json());


const videosDir = path.join(__dirname, "videos");
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir);
}


app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "FFmpeg server is healthy",
    time: new Date()
  });
});


app.get("/", (req, res) => {
  res.send("FFmpeg Server Running");
});


app.get("/generate-video", (req, res) => {
  const imagePath = path.join(__dirname, "assets", "image1.jpg");
  const audioPath = path.join(__dirname, "assets", "audio.mp3");

  if (!fs.existsSync(imagePath)) {
    return res.status(400).send("image1.jpg not found in server/assets");
  }
  if (!fs.existsSync(audioPath)) {
    return res.status(400).send("audio.mp3 not found in server/assets");
  }

  const outputPath = path.join(
    __dirname,
    "videos",
    `video-${Date.now()}.mp4`
  );

  ffmpeg()
    .input(imagePath)
    .inputOptions(["-loop 1"])
    .input(audioPath)
    .outputOptions([
      "-t 5",
      "-c:v libx264",
      "-c:a aac",
      "-pix_fmt yuv420p",
      "-shortest",
    ])
    .save(outputPath)
    .on("start", (commandLine) => {
      console.log("Spawned Ffmpeg with command: " + commandLine);
    })
    .on("error", (err) => {
      console.error("Error:", err);
      res.status(500).send("Error generating video: " + err.message);
    })
    .on("end", () => {
      console.log("Video created:", outputPath);
      if (!fs.existsSync(outputPath)) {
        return res.status(500).send("Video file was not created");
      }
      res.sendFile(outputPath);
    });
});


/* ======================= */
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
