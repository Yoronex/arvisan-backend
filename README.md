# Architecture Visualization & Analysis (ARVISAN) backend

This is the backend for the proof-of-concept architecture
visualizer and analysis tool for the graduation project of Roy Kakkenberg.

The frontend can be found here: https://github.com/yoronex/arvisan-frontend.

The input data parser can be found here: https://github.com/Yoronex/arvisan-input-parser. 

## How to deploy
The easiest method for deployment is to use Docker Compose, which requires Docker.
You can either use a Neo4j database instance installed on the host machine (e.g. using Neo4j Desktop, see the requirements below)
or use a Neo4j Docker container.
When using the latter, you can seed the database via one of two ways. 
1. Inject the dataset into a Docker volume and use Neo4j Admin tools. 
See the [Github wiki page](https://github.com/Yoronex/arvisan-backend/wiki/Inserting-data-into-a-Neo4j-docker-container) explaining how to seed the data using this method.
2. Use the [Arvisan Input Data Parser](https://github.com/Yoronex/arvisan-input-parser), which is integrated into the Arvisan backend.
In the "Overview" window, press the "Seeder" button to get started.

If you do not wish to use the Neo4j Docker container, don't forget to comment/remove this service and its volumes.

## Requirements for local installation
- NodeJS 20. Dependencies are installed with pnpm.
- A Neo4j database (v5) with the APOC plugin installed. 
To install APOC in Neo4j Desktop, click your database project in the app and a sidebar should open on the right.
You can install APOC from the "Plugins" tab.

### Database (Neo4j)
Because the tool outputs a graph, a graph database is required for easier querying.
In this case, an instance of Neo4j is used as a database.
The backend only reads the data; it does not do any insertions.
Therefore, you have to add any data to the database yourself.

The backend also requires a certain database structure.
First, all the nodes should be layered/clustered.
During development, the following graph layers (from top to bottom) and have been used:

- Domain
- Application
- Sublayer, together with one of sublayer_Enduser, sublayer_Core, sublayer_API, sublayer_CompositeLogic, sublayer_CoreService, sublayer_CoreWidgets
sublayer_Foundation, sublayer_StyleGuide, sublayer_FoundationService, sublayer_Library*
- Module

_* Labels should only contain alphanumerical characters within the limitations of Neo4j. If a label contains an underscore,
this will be interpreted as a "class" of nodes within the layer._

The hierarchical tree-like structure should always have a top layer with only "Domain" nodes.
There should __not__ be a single root node that contains all "Domain" nodes (i.e. the domain layer
(top layer) is not contained by any other layers).
Every graph layer should be linked to the graph layer above using a directed relationship with the "CONTAINS" label.

Each sublayer node has the label "Sublayer" and one of the class labels.
It has exactly one directed containment edge from an application.

Dependencies should only exist on the lower "Module" layer.
These relationships can have any label, but during testing the label CALLS was used.

Violation rules are also defined in the database.
- Sublayer violations are added to the database, simply as a VIOLATES relationship between two sublayer nodes.

The [example datasets folder](example-dataset) contains a set of nodes a set of relationships, which can be used as an example.
See "How to deploy" how this dataset can be seeded in a production environment.
For a local installation, it's best to use Neo4j Admin tools.

## How to install
To get started quickly, use docker-compose in this repository.
This stack contains the backend, frontend, and an empty Neo4j database instance.
The Neo4j database within the Docker stack can also be replaced by a local Neo4j instance (for example Neo4j Desktop).

To install the backend manually:
- Install NodeJS 20 and npm.
- Install Neo4j and create a database with a corresponding user. Don't forget to install APOC as well.
- Copy .env-example to .env. Add the Neo4j user credentials (username and password) to the Neo4j environment variables.
Also choose a username and password, which is used to authenticate with this backend.
- Install all dependencies: `npm install`.
- Start the application: `npm run dev`. If you get an error 
- The backend is now accessible on http://localhost:3000. The API documentation can be viewed at http://localhost:3000/api-docs
