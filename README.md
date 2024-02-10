# 😎 Bazed.ai Agent Framework

Visit [bazed.ai](https://bazed.ai) for more information.

## 📦 Installation

To create a new Bazed.ai Agent Framework project, run the following command and follow the instructions:

```bash
npx @bazed-ai/bazed-af init my-project
```

It will create `my-project` directory and set up a fresh Bazed.ai Agent Framework project there.

Remember to install dependencies with `yarn` or `npm install`!

See the [documentation](https://bazed.ai/installation.html) for more information.

## 📚 Documentation

The documentation for the Bazed.ai Agent Framework can be found [here](https://bazed.ai/introduction.html).

## 🚀 Usage

Bazed.ai Agent Framework comes with a dev server with hot reloading. To start it, run the following command:

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

See the [documentation](https://bazed.ai/first-agent.html) for more information.

## 🤝 Contributing

Contributions, issues and feature requests are welcome!

Check our [issues page](https://github.com/bazed-ai/bazed-af/issues).

Join our [Discord server](https://discord.gg/VmEEUrc7dg) to discuss new features or ask questions.

## 📝 License

This project is [MIT](https://opensource.org/license/mit/) licensed.

See the [LICENSE](/LICENSE) file.

Copyright (c) 2024 Ahyve Inc.
