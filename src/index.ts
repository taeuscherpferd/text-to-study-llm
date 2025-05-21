import axios from 'axios';
import * as fs from 'fs';
import { Ollama } from 'ollama'; // Added import
import * as path from 'path';

console.log("Hello TypeScript");


async function CallAnkiApi(action: string, version: number, params = {}) {
  try {
    const response = await axios.post('http://127.0.0.1:8765', { action, version, params });
    const data = response.data;

    if (Object.keys(data).length !== 2) {
      throw new Error('response has an unexpected number of fields');
    }
    if (!data.hasOwnProperty('error')) {
      throw new Error('response is missing required error field');
    }
    if (!data.hasOwnProperty('result')) {
      throw new Error('response is missing required result field');
    }
    if (data.error) {
      throw new Error(data.error);
    }

    return data.result;
  } catch (error: any) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      throw new Error(error.response.data.error || 'An error occurred');
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error('No response received from server');
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error(error.message ?? 'An error occurred');
    }
  }
}

const addCardsToDeck = async (noteType: string, notes: Array<{ front: string, back: string }>) => {
  const deckName = "GreatestEstateDeveloper"
  console.log(`Attempting to add ${notes.length} cards to deck "${deckName}" with note type "${noteType}"`);
  const notesToAdd = notes.map(note => ({
    deckName: deckName,
    modelName: noteType,
    fields: {
      Front: note.front, // Assuming 'Front' and 'Back' are the field names in your Anki note type
      Back: note.back
    },
    options: {
      allowDuplicate: false // You can configure this as needed
    },
    tags: []
  }));

  try {
    const result = await CallAnkiApi('addNotes', 6, { notes: notesToAdd });
    console.log('Cards added successfully:', result);
    return { success: true, added_count: result.filter((id: any) => id !== null).length, results: result };
  } catch (error: any) {
    console.error('Error adding cards to deck:', error.message);
    return { success: false, error: error.message };
  }
}

const getCardsFromDeck = async (): Promise<{ noteId: number; front: string; back: string; }[]> => {
  const deckName = "GreatestEstateDeveloper"

  console.log(`Attempting to get cards from deck "${deckName}"`);
  try {
    const noteIds = await CallAnkiApi('findNotes', 6, { query: `deck:"${deckName}"` });
    if (!noteIds || noteIds.length === 0) {
      console.log(`No notes found in deck "${deckName}".`);
      return [];
    }
    const notesInfo = await CallAnkiApi('notesInfo', 6, { notes: noteIds });

    // Assuming 'Front' and 'Back' are the field names
    return notesInfo.map((note: any) => ({
      noteId: note.noteId,
      front: note.fields.Front?.value ?? '',
      back: note.fields.Back?.value ?? ''
    }));
  } catch (error: any) {
    console.error('Error getting cards from deck:', error.message);
    return [];
  }
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'addCardsToDeck',
      description: 'Adds a list of new cards (notes) to a specified Anki deck.',
      parameters: {
        type: 'object',
        properties: {
          noteType: {
            type: 'string',
            description: 'The Anki note type to use for the new cards (e.g., "Basic", "Basic (and reversed card)").',
          },
          notes: {
            type: 'array',
            description: 'An array of notes to add. Each note should have a "front" and "back".',
            items: {
              type: 'object',
              properties: {
                front: {
                  type: 'string',
                  description: 'The content for the front of the card.',
                },
                back: {
                  type: 'string',
                  description: 'The content for the back of the card.',
                },
              },
              required: ['front', 'back'],
            },
          },
        },
        required: ['noteType', 'notes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCardsFromDeck',
      description: 'Retrieves all cards (notes) from a specified Anki deck.',
      parameters: {
        type: 'object',
        properties: {
          noteType: {
            type: 'string',
            description: 'Unused for this function.',
          },
          notes: {
            type: 'array',
            description: 'Unused for this function.',
            items: {
              type: 'object',
              properties: {
                front: { type: 'string', description: 'Unused.' },
                back: { type: 'string', description: 'Unused.' },
              },
              required: ['front', 'back'],
            },
          },
        },
        required: [],
      },
    },
  },
];

const llmParseImage = async (imagePath: string) => {
  const image = fs.readFileSync(imagePath);
  const base64Image = Buffer.from(image).toString('base64');

  const ollama = new Ollama({ host: 'http://localhost:11434' }); // Default host

  const availableFunctions: { [key: string]: Function } = { // Explicitly type availableFunctions
    addCardsToDeck: addCardsToDeck,
    getCardsFromDeck: getCardsFromDeck,
  };

  const previousCards = (await getCardsFromDeck()).reduce((prev, card) => {
    return prev + " " + card.front 
  }, "");


  try {
    console.log('Sending request to Ollama to parse image...');
    const response = await ollama.chat({ // Corrected the call structure
      model: 'mistral-small3.1', // Ensure you have this model or change to one you have e.g. 'llama3'
      messages: [
        {
          role: 'user',
          content: `Parse the Korean text in this image. Identify the subject matter and create Anki flashcards for the Korean vocabulary. Ensure that duplicates are not being added. For reference, here are all of the previously added cards${previousCards}. Use the addCardsToDeck tool to add these new Korean vocab cards to the Anki deck. For the notes, provide "front" and "back" content. `,
          images: [base64Image] // Pass base64 image directly if model supports it, or describe it in text.
          // For multimodal models like llava, this is how you pass images.
          // If your model doesn't directly support base64 in 'images' array, 
          // ensure the prompt clearly states the content is an image and describes it.
        },
      ],
      tools: tools, // Pass the tool definitions
      stream: false, // Set to true if you want to stream the response
    });

    console.log('Ollama response:', JSON.stringify(response, null, 2));

    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      console.log('Tool calls requested by the model:');
      const toolMessages = [];

      for (const toolCall of response.message.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = toolCall.function.arguments;

        console.log(`Calling function: ${functionName} with args:`, functionArgs);

        if (availableFunctions[functionName]) {
          let functionResponse;
          if (functionName === 'addCardsToDeck') {
            functionResponse = await availableFunctions[functionName](
              functionArgs.noteType,
              functionArgs.notes
            );
          } else if (functionName === 'getCardsFromDeck') {
            functionResponse = await availableFunctions[functionName]();
          } else {
            console.error(`Unknown function call: ${functionName}`);
            functionResponse = `Error: Unknown function ${functionName}`;
          }

          console.log(`Response from ${functionName}:`, functionResponse);
          toolMessages.push({
            role: 'tool',
            tool_call_id: (toolCall as any).tool_call_id ?? (toolCall as any).id,// Use the correct property for tool call id
            name: functionName,
            content: JSON.stringify(functionResponse),
          });
        } else {
          console.error(`Function ${functionName} is not available.`);
          toolMessages.push({
            role: 'tool',
            tool_call_id: (toolCall as any).tool_call_id ?? (toolCall as any).id,
            name: functionName,
            content: `Error: Function ${functionName} not found.`,
          });
        }
      }

      // Optional: Send tool responses back to the model for a final answer
      if (toolMessages.length > 0) {
        console.log('Sending tool responses back to Ollama...');
        const finalResponse = await ollama.chat({
          model: 'mistral-small3.1', // Ensure you have this model or change to one you have e.g. 'llama3'
          messages: [
            {
              role: 'user',
              content: `Parse the Korean text in this image. Identify the subject matter and create Anki flashcards for the Korean vocabulary. Ensure that duplicates are not being added. For reference, here are all of the previously added cards${previousCards}. Use the addCardsToDeck tool to add these new Korean vocab cards to the Anki deck. For the notes, provide "front" and "back" content. `,
              images: [base64Image]
            },
            response.message, // Previous assistant message with tool_calls
            ...toolMessages     // Results from tool calls
          ],
          stream: false,
        });
        console.log('Final Ollama response after tool execution:', JSON.stringify(finalResponse, null, 2));
        return finalResponse.message.content;
      }
    } else {
      console.log('No tool calls requested. Assistant message:', response.message.content);
      return response.message.content;
    }

  } catch (error) {
    console.error('Error in llmParseImage:', error);
    throw error;
  }
}

const main = async () => {
  // Collect all images from the InputImages folder
  const inputImagesDir = path.join(__dirname, "../", 'InputImages');
  const images = fs.readdirSync(inputImagesDir).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.gif';
  });

  if (images.length > 0) {
    for (const element of images) {
      const imagePath = path.join(inputImagesDir, element);
      console.log(`Processing image: ${imagePath}`);
      try {
        const llmResult = await llmParseImage(imagePath);
        console.log("LLM processing result:", llmResult);
      } catch (e) {
        console.error("Error processing image with LLM:", e);
      }
    }
  } else {
    console.log("No images found in InputImages folder.");
  }

  console.log("Processing complete.");
};

main().catch(e => console.error("Unhandled error in main:", e));

