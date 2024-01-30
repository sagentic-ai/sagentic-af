# 😎 Bazed.ai Agent Framework

## 📦 Installation

To create a new Bazed.ai Agent Framework project, run the following command and follow the instructions:

```bash
npx @bazed-ai/bazed-af init my-project
```

It will create `my-project` directory and set up a fresh Bazed.ai Agent Framework project there.

Remember to install dependencies with `yarn` or `npm install`!

## 🚀 Usage

Bazed.ai Agent Framework comes with a dev server with hot reloading. To start it, run the following command:

```bash
yarn dev
# or
npm run dev
```

Visit `http://localhost:3000` to see the dev server dashboard listing your agents.

You can spawn agents by calling `/spawn` endpoint:

```bash
curl -X POST http://localhost:3000/spawn -d '{"name": "my-agent", "type": "my-agent-type", "options": {"foo": "bar"}}'
```

## 📚 Documentation

The documentation for the Bazed.ai Agent Framework can be found [here](https://bazed.ai/).

## 🤝 Contributing

Contributions, issues and feature requests are welcome!
