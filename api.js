const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');
const cors = require('cors');

// ✅ Parse service account from environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// ✅ Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'alphie3000.appspot.com',
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
app.use(cors()); // ✅ Enable CORS if calling from frontend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Multer setup for in-memory uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // Max: 100MB
});

// ✅ Upload video endpoint
app.post('/upload', upload.single('video'), async (req, res) => {
  const { file } = req;
  const { userId, username, title, description } = req.body;

  if (!file) return res.status(400).send('No file uploaded.');
  if (!userId || !username) return res.status(400).send('User ID and username are required.');

  const fileName = `videos/${Date.now()}-${file.originalname}`;
  const videoFile = bucket.file(fileName);

  const blobStream = videoFile.createWriteStream({
    resumable: false,
    metadata: { contentType: file.mimetype },
  });

  blobStream.on('error', (err) => {
    console.error('❌ Stream error:', err);
    res.status(500).send(`Error uploading: ${err.message}`);
  });

  blobStream.on('finish', async () => {
    try {
      await videoFile.makePublic();
      const downloadURL = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

      const videoData = {
        user: {
          id: userId,
          username,
        },
        title: title || 'Untitled',
        description: description || 'No description',
        storagePath: fileName,
        downloadURL,
        comments: 0,
        likes: 0,
        dislikes: 0,
        hearts: 0,
        money: 0,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await db.collection('videos').add(videoData);
      res.status(200).json({ id: docRef.id, ...videoData });
    } catch (error) {
      console.error('❌ Upload error:', error);
      res.status(500).json({ error: `Error saving metadata: ${error.message}` });
    }
  });

  blobStream.end(file.buffer);
});

// ✅ Get all videos
app.get('/videos', async (req, res) => {
  try {
    const snapshot = await db.collection('videos').orderBy('timestamp', 'desc').get();
    if (snapshot.empty) return res.status(200).json([]);
    const videos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ error: `Error fetching videos: ${error.message}` });
  }
});

// ✅ Rank users by likes
app.get('/ranked-users', async (req, res) => {
  try {
    const snapshot = await db.collection('videos').get();
    if (snapshot.empty) return res.status(200).json([]);

    const userStats = {};
    snapshot.docs.forEach((doc) => {
      const { user, likes = 0 } = doc.data();
      if (!user || !user.id) return;

      if (!userStats[user.id]) {
        userStats[user.id] = { username: user.username, likes: 0 };
      }
      userStats[user.id].likes += likes;
    });

    const rankedUsers = Object.entries(userStats)
      .map(([userId, stats]) => ({ userId, ...stats }))
      .sort((a, b) => b.likes - a.likes);

    res.status(200).json(rankedUsers);
  } catch (error) {
    res.status(500).json({ error: `Error ranking users: ${error.message}` });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

