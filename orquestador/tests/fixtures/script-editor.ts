import { createApp, h } from "vue";
void (
  location.search.includes("policy")
    ? import("./script-policy.vue")
    : location.search.includes("references")
      ? import("./script-references.vue")
      : import("./script-editor.vue")
).then(({ default: Fixture }) =>
  createApp(Fixture)
    .component("Button", {
      setup:
        (_, { slots }) =>
        () =>
          h("button", slots.default?.()),
    })
    .mount("#app"),
);
