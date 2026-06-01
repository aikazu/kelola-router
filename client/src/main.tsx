import { render } from "preact";
import { App } from "./App";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/animations.css";

const root = document.getElementById("app");
if (root) render(<App />, root);
