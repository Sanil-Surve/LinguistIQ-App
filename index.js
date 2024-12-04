const express = require('express');
const cors = require('cors');
require('dotenv').config();

const OpenAI = require("openai");

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// OpenAI API configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to interact with OpenAI API (Chat Completion)
const generateChatCompletion = async (userPrompt, model, messagePrefix) => {
  try {
    const chatCompletion = await openai.chat.completions.create({
      messages: [
        { role: "user", content: `${messagePrefix}: ${userPrompt}` },
      ],
      model: model || "gpt-3.5-turbo",
    });
    return chatCompletion.choices[0].message.content;
  } catch (error) {
    console.error('Error with OpenAI API:', error);
    throw new Error('Failed to generate completion');
  }
};

// Route to generate lesson content
app.post('/api/generateLesson', async (req, res) => {
  const { userInput } = req.body;
  if (!userInput) {
    return res.status(400).json({ error: 'User input is required' });
  }

  try {
    const lesson = await generateChatCompletion(
      userInput,
      "gpt-3.5-turbo",
      "Generate a language lesson based on this input"
    );
    res.json({ lesson });
  } catch (error) {
    res.status(500).json({ error: 'Error generating lesson' });
  }
});

// Route to generate quiz questions
app.post('/api/generateQuizzes', async (req, res) => {
  const { lessonContent } = req.body;
  if (!lessonContent) {
    return res.status(400).json({ error: 'Lesson content is required' });
  }

  try {
    const quizzes = await generateChatCompletion(
      lessonContent,
      "gpt-3.5-turbo",
      "Based on the following lesson, generate 5 quiz multiple choice questions with answers(which can be hide and see again)."
    );
    res.json({ quizzes });
  } catch (error) {
    res.status(500).json({ error: 'Error generating quizzes' });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});