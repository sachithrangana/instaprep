# React Frontend for Book Browser

This is the React frontend application for the GraphRAG Book Browser.

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start development server**:
   ```bash
   npm start
   ```
   
   This will start the React app on `http://localhost:3000` with hot-reload.

3. **Build for production**:
   ```bash
   npm run build
   ```
   
   This creates an optimized production build in the `build` folder.

## Development

- The app runs on port 3000 by default
- API requests are proxied to `http://localhost:5000` (configured in package.json)
- Make sure the Flask backend is running on port 5000

## Project Structure

```
frontend/
├── public/
│   └── index.html          # HTML template
├── src/
│   ├── components/         # React components
│   │   ├── BookList.js     # Book listing component
│   │   ├── BookDetails.js  # Book details component
│   │   └── SectionModal.js # Section viewer modal
│   ├── App.js              # Main app component
│   ├── App.css             # App styles
│   ├── index.js            # Entry point
│   └── index.css           # Global styles
├── package.json            # Dependencies and scripts
└── README.md               # This file
```

## Available Scripts

- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run eject` - Eject from Create React App (irreversible)

