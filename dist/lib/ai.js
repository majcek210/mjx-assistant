"use strict";
const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();
// The client gets the API key from the environment variable `GEMINI_API_KEY`.
const ai = new GoogleGenAI({});
async function main() {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: "Explain how AI works in a few words",
    });
    console.log(response.text);
}
main();
