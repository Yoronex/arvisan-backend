# Architecture Analysis Visualization (ARANVIS) backend

This is the backend for the proof-of-concept architecture
visualizer and analysis tool for the graduation project of Roy Kakkenberg.

## Requirements
This backend has been built with NodeJS 20.
Dependencies are installed with pnpm.

### Database
Because the tool outputs a graph, a relation database is required.
In this case, an instance of Neo4j is used as a database.
The backend only reads the data; it does not do any insertions.
Therefore, you have to add any data to the database yourself.

Then, the backend also requires a certain database structure.
First, all the nodes should be layered in the following layers (from top to bottom) and have the following labels:

- Domain
- Application
- (optionally one of Layer_Core, Layer_Enduser, Layer_Foundation)
- One of Sublayer_Enduser, Sublayer_Core, Sublayer_API, Sublayer_CompositeLogic, Sublayer_CoreService, Sublayer_CoreWidgets
Sublayer_Foundation, Sublayer_StyleGuide, Sublayer_FoundationService, Sublayer_Library
- Module

Every layer should be linked to the layer above with a relationship with the "CONTAINS" label.

Dependencies should only exist on the lower "Module" layer.
These relationships can have any label, but during testing the labels CALLS, USES, RENDERS, and CATCHES were used.

During development and testing, data has been imported using a custom parser.
Due to security and intellectual property considerations, this repository shall not be published. 