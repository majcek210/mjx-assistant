import Client from "mjx-client/dist/client"

const client = new Client()

client.registerCommandsRoute("src/connections/commands")
client.registerEventsRoute("dist/connections/events")

client.setName("Mjx assistant")
client.setDebug(true)

export default client