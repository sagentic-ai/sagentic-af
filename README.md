# 😎 Sagentic.ai Agent Framework

Visit [sagentic.ai](https://sagentic.ai) for more information.

Join our [Discord server](https://discord.gg/VmEEUrc7dg) for support and discussions.

## 📦 Installation

To create a new Sagentic.ai Agent Framework project, run the following command and follow the instructions:

```bash
npx @sagentic-ai/sagentic-af init my-project
```

It will create `my-project` directory and set up a fresh Sagentic.ai Agent Framework project there.

Remember to install dependencies with `yarn` or `npm install`!

See the [documentation](https://sagentic.ai/installation.html) for more information.

## 📚 Documentation

The documentation for the Sagentic.ai Agent Framework can be found [here](https://sagentic.ai/introduction.html).

## 🚀 Usage

Sagentic.ai Agent Framework comes with a dev server with hot reloading. To start it, run the following command:

```bash
yarn dev
# or
npm run dev
```

You can spawn agents locally by calling `/spawn` endpoint:

```bash
curl -X POST http://localhost:3000/spawn \
    -H "Content-Type: application/json" \
    -d '{"type": "my-project/MyAgent",
        "options": {
            ...
        }'
```

See the [documentation](https://sagentic.ai/first-agent.html) for more information.

## 🤝 Contributing

Contributions, issues and feature requests are welcome!

Check our [issues page](https://github.com/sagentic-ai/sagentic-af/issues).

## 📝 License

This project is [MIT](https://opensource.org/license/mit/) licensed.

See the [LICENSE](/LICENSE) file.

Copyright (c) 2024 Ahyve Inc.
