# Architecture Visualization & Analysis (ARVISAN) backend

This is the backend for the proof-of-concept architecture
visualizer and analysis tool for the graduation project of Roy Kakkenberg.

## Requirements
- NodeJS 20. Dependencies are installed with pnpm.
- A Neo4j database (v5) with the APOC plugin installed. 
To install APOC in Neo4j Desktop, click your database project in the app and a sidebar should open on the right.
You can install APOC from the "Plugins" tab.

### Database (Neo4j)
Because the tool outputs a graph, a graph database is required for easier querying.
In this case, an instance of Neo4j is used as a database.
The backend only reads the data; it does not do any insertions.
Therefore, you have to add any data to the database yourself.

Then, the backend also requires a certain database structure.
First, all the nodes should be layered/clustered.
During development, the following layers (from top to bottom) and have been used:

- Domain
- Application
- (optionally one of Layer_Core, Layer_Enduser, Layer_Foundation)
- One of sublayer_Enduser, sublayer_Core, sublayer_API, sublayer_CompositeLogic, sublayer_CoreService, sublayer_CoreWidgets
sublayer_Foundation, sublayer_StyleGuide, sublayer_FoundationService, sublayer_Library*
- Module

_* Labels should only contain alphanumerical characters within the limitations of Neo4j. If a label contains an underscore,
this will be interpreted as a "class" of nodes within the layer._

The hierarchical tree-like structure should always have a top layer with only "Domain" nodes.
There should __not__ be a single root node that contains all "Domain" nodes (i.e. the domain layer
(top layer) is not contained by any other layers).
Every layer should be linked to the layer above with a relationship with the "CONTAINS" label.
A sublayer should always be contained by the layer above. It can have a different class.

There is exactly one layer label for each sublayer. In the end, all leaf nodes in the hierarchical
structure should be contained in all the layers.

Dependencies should only exist on the lower "Module" layer.
These relationships can have any label, but during testing the labels CALLS, USES, RENDERS, and CATCHES were used.

Violation rules are also defined in the database.
- Sublayer violations are added to the database, simply as a VIOLATES relationship between two sublayer nodes.

During development and testing, data has been imported using a custom parser.
Due to security and intellectual property considerations, this repository shall not be published. 

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
- Start the application: `npm run dev`.
- The backend is now accessible on http://localhost:3000. The API documentation can be viewed at http://localhost:3000/api-docs
