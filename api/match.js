import { google } from 'googleapis';

export default async function handler(req, res) {
  // Only accept POST requests from your Apps Script
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { videoId, title, description } = req.body;

  try {
    // 1. Fetch all your GitHub Repositories
    const githubRes = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });
    const repos = await githubRes.json();
    const repoList = repos.map(r => `${r.name}: ${r.html_url}`).join('\n');

    // 2. Ask OpenAI to find the perfect match
    const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an automated assistant. Find the single GitHub repository that perfectly matches the YouTube video context. Return ONLY the raw URL of the matching repository. Do not include any greeting, markdown, quotes, or explanation. If no match exists, return "NONE".'
          },
          {
            role: 'user',
            content: `Video Title: ${title}\nVideo Description: ${description}\n\nMy GitHub Repositories:\n${repoList}`
          }
        ],
        temperature: 0.1 
      })
    });
    
    const aiData = await openAiRes.json();
    const matchedUrl = aiData.choices[0].message.content.trim();

    // If AI decides there is no code for this video, stop here.
    if (matchedUrl === 'NONE' || !matchedUrl.startsWith('http')) {
      return res.status(200).json({ message: 'No matching repo found. Skipped.' });
    }

    // 3. Post the comment to YouTube
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    await youtube.commentThreads.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          videoId: videoId,
          topLevelComment: {
            snippet: {
              textOriginal: `Github link: ${matchedUrl}`
            }
          }
        }
      }
    });

    return res.status(200).json({ success: true, posted: matchedUrl });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
